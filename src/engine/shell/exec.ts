import {
  resolve,
  S_ISGID,
  S_ISUID,
  VfsError,
  type Credentials,
  type Stat,
} from '../vfs/index.ts'
import type { Host } from '../world/host.ts'
import { expandWord, type ExpandContext } from './expand.ts'
import { ShellSyntaxError, type Word } from './lexer.ts'
import { parse, type Pipeline, type SimpleCommand } from './parser.ts'
import {
  UsageError,
  type CommandInfo,
  type Effect,
  type ProgramContext,
  type ProgramRegistry,
  type ProgramResult,
} from './types.ts'

export const DEFAULT_PATH = '/bin:/usr/bin:/usr/ucb:/usr/local/bin'

/** Scripts calling scripts are cut off here, so a script that runs itself cannot hang the game. */
const MAX_DEPTH = 16

/** The state of one shell process. */
export interface ShellEnv {
  host: Host
  programs: ProgramRegistry
  /** Effective credentials. */
  cred: Credentials
  /** Real user id: who logged in. */
  ruid: number
  cwd: string
  vars: Map<string, string>
  /** `$1`, `$2`, … */
  positional: string[]
  /** `$0` */
  scriptName: string
  tty: string | null
  /** True for a shell someone is typing at. */
  interactive: boolean
  depth: number
  /** `$?` */
  lastStatus: number
  history: string[]
  /** Called after every simple command, at any depth. */
  onCommand?: (info: CommandInfo) => void
}

export interface ExecIO {
  stdin: string
  stdinIsTTY: boolean
  stdoutIsTTY: boolean
  out: (text: string) => void
  err: (text: string) => void
  /** Told about each effect at the moment it happens, in order with the output. */
  onEffect?: (effect: Effect) => void
}

export interface ExecResult {
  status: number
  effects: Effect[]
}

/** Summaries for the commands the shell handles itself. */
export const BUILTINS: ReadonlyMap<string, string> = new Map([
  ['cd', 'change the working directory'],
  ['exit', 'leave the current shell'],
  ['help', 'list the commands on this system'],
  ['history', 'list the commands you have typed'],
])

function variable(env: ShellEnv, name: string): string | undefined {
  if (name === '?') return String(env.lastStatus)
  if (name === '#') return String(env.positional.length)
  if (name === '*' || name === '@') return env.positional.join(' ')
  if (name === '$') return String(100 + env.depth)
  if (name === '0') return env.scriptName
  if (/^[1-9]$/.test(name)) return env.positional[Number(name) - 1]
  return env.vars.get(name)
}

function expandContext(env: ShellEnv): ExpandContext {
  return {
    variable: (name) => variable(env, name),
    cwd: env.cwd,
    listDir: (path) => {
      try {
        return env.host.fs.readdir(path, env.cred)
      } catch {
        return undefined
      }
    },
    exists: (path) => {
      try {
        return env.host.fs.tryStat(path, env.cred) !== undefined
      } catch {
        return false
      }
    },
    homeOf: (user) =>
      user === undefined ? env.vars.get('HOME') : env.host.users.byName(user)?.home,
  }
}

function pathDirs(env: ShellEnv): string[] {
  return (env.vars.get('PATH') ?? DEFAULT_PATH).split(':').filter((d) => d !== '')
}

/** Find the file a command name refers to: a path if it has a slash, else a PATH search. */
function findProgram(env: ShellEnv, name: string): { path: string; stat: Stat } | undefined {
  const candidates = name.includes('/')
    ? [resolve(env.cwd, name)]
    : pathDirs(env).map((dir) => resolve(dir, name))
  for (const path of candidates) {
    try {
      const stat = env.host.fs.tryStat(path, env.cred)
      if (stat && stat.kind === 'file') return { path, stat }
    } catch {
      // A directory on the PATH we cannot search: keep looking.
    }
  }
  return undefined
}

/** Every command name this shell could run: builtins plus executables on the PATH. */
export function commandNames(env: ShellEnv): string[] {
  const names = new Set<string>(BUILTINS.keys())
  for (const dir of pathDirs(env)) {
    let entries: string[]
    try {
      entries = env.host.fs.readdir(dir, env.cred)
    } catch {
      continue
    }
    for (const name of entries) {
      if (env.host.fs.access(resolve(dir, name), env.cred, 'x')) names.add(name)
    }
  }
  return [...names].sort()
}

/** Typing mistakes between two words: a wrong, missing, extra or swapped letter each count once. */
function editDistance(a: string, b: string): number {
  const rows: number[][] = [Array.from({ length: b.length + 1 }, (_, j) => j)]
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        rows[i - 1]![j]! + 1,
        row[j - 1]! + 1,
        rows[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j]!, rows[i - 2]![j - 2]! + 1)
      }
    }
    rows.push(row)
  }
  return rows[a.length]![b.length]!
}

function notFound(env: ShellEnv, name: string): string {
  let best: string | undefined
  let bestDistance = Infinity
  for (const candidate of commandNames(env)) {
    const distance = editDistance(name, candidate)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  const close = best !== undefined && bestDistance <= (name.length > 4 ? 2 : 1)
  const hint = close ? `Did you mean "${best}"?` : 'Type "help" to list the commands.'
  return `${name}: Command not found. ${hint}\n`
}

function childEnv(env: ShellEnv, cred: Credentials, name: string, args: string[]): ShellEnv {
  return {
    ...env,
    cred,
    vars: new Map(env.vars),
    positional: args,
    scriptName: name,
    interactive: false,
    depth: env.depth + 1,
    lastStatus: 0,
    history: [],
  }
}

/** Run shell source in a child shell and collect its output. */
function runCaptured(env: ShellEnv, source: string, stdin: string, stdinIsTTY: boolean): ProgramResult {
  let stdout = ''
  let stderr = ''
  const { status } = execute(env, source, {
    stdin,
    stdinIsTTY,
    stdoutIsTTY: false,
    out: (text) => (stdout += text),
    err: (text) => (stderr += text),
  })
  return { stdout, stderr, status }
}

// ---- builtins ---------------------------------------------------------------

function builtinCd(env: ShellEnv, argv: string[]): ProgramResult {
  const target = argv[1] ?? env.vars.get('HOME') ?? '/'
  const path = resolve(env.cwd, target)
  try {
    const stat = env.host.fs.stat(path, env.cred)
    if (stat.kind !== 'dir') return { stdout: '', stderr: `cd: ${target}: Not a directory\n`, status: 1 }
  } catch (err) {
    if (!(err instanceof VfsError)) throw err
    return { stdout: '', stderr: `cd: ${target}: ${err.message}\n`, status: 1 }
  }
  if (!env.host.fs.access(path, env.cred, 'x')) {
    return { stdout: '', stderr: `cd: ${target}: Permission denied\n`, status: 1 }
  }
  env.cwd = path
  return { stdout: '', stderr: '', status: 0 }
}

function builtinHistory(env: ShellEnv): ProgramResult {
  const stdout = env.history.map((line, i) => `${String(i + 1).padStart(5)}  ${line}\n`).join('')
  return { stdout, stderr: '', status: 0 }
}

function builtinHelp(env: ShellEnv): ProgramResult {
  const rows: [string, string][] = []
  for (const name of commandNames(env)) {
    const builtin = BUILTINS.get(name)
    if (builtin !== undefined) {
      rows.push([name, builtin])
      continue
    }
    const found = findProgram(env, name)
    const program = found?.stat.program ? env.programs.get(found.stat.program) : undefined
    rows.push([name, program?.summary ?? ''])
  }
  const width = Math.max(...rows.map(([name]) => name.length))
  const stdout =
    rows.map(([name, summary]) => `${name.padEnd(width)}  ${summary}`.trimEnd() + '\n').join('') +
    '\nFor more about a command, type "man" and its name: man ls\n'
  return { stdout, stderr: '', status: 0 }
}

// ---- running one command ----------------------------------------------------

interface Stage {
  stdin: string
  stdinIsTTY: boolean
  stdoutIsTTY: boolean
}

function runCommand(env: ShellEnv, argv: string[], stage: Stage): ProgramResult & { path: string | null; exit?: boolean } {
  const name = argv[0]!

  if (name === 'cd') return { ...builtinCd(env, argv), path: null }
  if (name === 'history') return { ...builtinHistory(env), path: null }
  if (name === 'help') return { ...builtinHelp(env), path: null }
  if (name === 'exit') {
    const code = argv[1] === undefined ? env.lastStatus : Number(argv[1])
    return {
      stdout: '',
      stderr: '',
      status: Number.isInteger(code) ? code : 2,
      path: null,
      exit: true,
    }
  }

  const found = findProgram(env, name)
  if (!found) {
    let stderr = notFound(env, name)
    if (name.includes('/')) {
      // A path was given, so say what is wrong with that path.
      try {
        const stat = env.host.fs.tryStat(resolve(env.cwd, name), env.cred)
        stderr = `${name}: ${stat ? 'Is a directory' : 'No such file or directory'}\n`
      } catch (err) {
        if (!(err instanceof VfsError)) throw err
        stderr = `${name}: ${err.message}\n`
      }
    }
    return { stdout: '', stderr, status: 127, path: null }
  }
  const { path, stat } = found
  if (!env.host.fs.access(path, env.cred, 'x')) {
    return { stdout: '', stderr: `${name}: Permission denied\n`, status: 126, path }
  }

  // The setuid and setgid bits: run as the file's owner or group, not the caller.
  const cred: Credentials = {
    uid: stat.mode & S_ISUID ? stat.uid : env.cred.uid,
    gid: stat.mode & S_ISGID ? stat.gid : env.cred.gid,
    groups:
      stat.mode & S_ISGID && !env.cred.groups.includes(stat.gid)
        ? [...env.cred.groups, stat.gid]
        : env.cred.groups,
  }

  if (env.depth >= MAX_DEPTH) {
    return { stdout: '', stderr: `${name}: too many nested commands\n`, status: 126, path }
  }

  if (stat.program === undefined) {
    // A text file with execute permission is a script: run it in a child shell.
    let source: string
    try {
      source = env.host.fs.readFile(path, cred)
    } catch (err) {
      if (!(err instanceof VfsError)) throw err
      return { stdout: '', stderr: `${name}: ${err.message}\n`, status: 126, path }
    }
    const child = childEnv(env, cred, name, argv.slice(1))
    return { ...runCaptured(child, source, stage.stdin, stage.stdinIsTTY), path }
  }

  const program = env.programs.get(stat.program)
  if (!program) {
    return { stdout: '', stderr: `${name}: cannot execute this program\n`, status: 126, path }
  }

  const ctx: ProgramContext = {
    name,
    args: argv.slice(1),
    stdin: stage.stdin,
    stdinIsTTY: stage.stdinIsTTY,
    stdoutIsTTY: stage.stdoutIsTTY,
    cwd: env.cwd,
    cred,
    ruid: env.ruid,
    host: env.host,
    fs: env.host.fs,
    tty: env.tty,
    variable: (key) => variable(env, key),
    resolve: (p) => resolve(env.cwd, p),
    runScript: (source, args, stdin) =>
      runCaptured(childEnv(env, cred, name, args), source, stdin, false),
    programs: env.programs,
  }

  try {
    return { ...program.run(ctx), path }
  } catch (err) {
    if (err instanceof UsageError) {
      return {
        stdout: '',
        stderr: `${name}: ${err.message}\nusage: ${program.usage}\n`,
        status: 2,
        path,
      }
    }
    if (err instanceof VfsError) {
      return { stdout: '', stderr: `${name}: ${err.path}: ${err.message}\n`, status: 1, path }
    }
    throw err
  }
}

// ---- pipelines --------------------------------------------------------------

const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=/

/** `NAME=value` on its own sets a shell variable. */
function tryAssignment(env: ShellEnv, command: SimpleCommand, ctx: ExpandContext): boolean {
  if (command.words.length !== 1 || command.redirects.length > 0) return false
  const word = command.words[0]!
  const first = word[0]!
  if (first.quote !== 'none') return false
  const match = ASSIGNMENT.exec(first.text)
  if (!match) return false
  const rest: Word = [{ text: first.text.slice(match[0].length), quote: 'none' }, ...word.slice(1)]
  env.vars.set(match[1]!, expandWord(rest, ctx).join(' '))
  return true
}

function runPipeline(
  env: ShellEnv,
  pipeline: Pipeline,
  io: ExecIO,
): { status: number; effects: Effect[]; exit: boolean } {
  let input = io.stdin
  let inputIsTTY = io.stdinIsTTY
  let status = 0
  let effects: Effect[] = []
  let exit = false
  const fs = env.host.fs

  pipeline.commands.forEach((command, index) => {
    const isLast = index === pipeline.commands.length - 1
    const ctx = expandContext(env)
    effects = []

    if (tryAssignment(env, command, ctx)) {
      status = 0
      input = ''
      inputIsTTY = false
      return
    }

    const argv = command.words.flatMap((word) => expandWord(word, ctx))
    let stdin = input
    let stdinIsTTY = inputIsTTY
    let outPath: string | undefined
    let blocked = false

    for (const redirect of command.redirects) {
      const targets = expandWord(redirect.target, ctx)
      if (targets.length !== 1) {
        io.err('Ambiguous redirect.\n')
        blocked = true
        break
      }
      const target = targets[0]!
      const path = resolve(env.cwd, target)
      try {
        if (redirect.op === '<') {
          stdin = fs.readFile(path, env.cred)
          stdinIsTTY = false
        } else {
          // The file is created or emptied before the command starts, as in
          // a real shell. That is why "sort f > f" destroys f.
          fs.writeFile(path, '', env.cred, { append: redirect.op === '>>' })
          outPath = path
        }
      } catch (err) {
        if (!(err instanceof VfsError)) throw err
        io.err(`${target}: ${err.message}\n`)
        blocked = true
        break
      }
    }

    let stdout = ''
    let path: string | null = null
    if (blocked || argv.length === 0) {
      status = blocked ? 1 : 0
    } else {
      const result = runCommand(env, argv, {
        stdin,
        stdinIsTTY,
        stdoutIsTTY: isLast && outPath === undefined && io.stdoutIsTTY,
      })
      stdout = result.stdout
      status = result.status
      path = result.path
      if (result.stderr !== '') io.err(result.stderr)
      if (isLast) {
        effects = result.effects ?? []
        exit = result.exit === true
      }
    }

    if (argv.length > 0) {
      env.onCommand?.({ argv, path, status, euid: env.cred.uid, depth: env.depth })
    }

    if (outPath !== undefined) {
      if (stdout !== '') {
        try {
          fs.writeFile(outPath, stdout, env.cred, { append: true })
        } catch (err) {
          if (!(err instanceof VfsError)) throw err
          io.err(`${outPath}: ${err.message}\n`)
          status = 1
        }
      }
      stdout = ''
    }

    if (isLast) {
      if (stdout !== '') io.out(stdout)
    } else {
      input = stdout
      inputIsTTY = false
    }
  })

  return { status, effects, exit }
}

/**
 * Run shell source: one line typed at a prompt, or a whole script. Output
 * goes to `io` as it is produced. Returns the status of the last command.
 */
export function execute(env: ShellEnv, source: string, io: ExecIO): ExecResult {
  let pipelines: Pipeline[]
  try {
    pipelines = parse(source)
  } catch (err) {
    if (!(err instanceof ShellSyntaxError)) throw err
    io.err(err.message + '\n')
    env.lastStatus = 2
    return { status: 2, effects: [] }
  }

  const effects: Effect[] = []
  for (const pipeline of pipelines) {
    const result = runPipeline(env, pipeline, io)
    env.lastStatus = result.status
    for (const effect of result.effects) {
      effects.push(effect)
      io.onEffect?.(effect)
    }
    if (result.exit) {
      const exit: Effect = { type: 'exit' }
      effects.push(exit)
      io.onEffect?.(exit)
      break
    }
  }
  return { status: env.lastStatus, effects }
}

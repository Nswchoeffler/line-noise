import type { AccessEvent, Credentials } from '../vfs/index.ts'
import type { Host } from '../world/host.ts'
import { DEFAULT_PATH, execute, type ShellEnv } from './exec.ts'
import type { CommandInfo, ProgramRegistry } from './types.ts'

export interface OutputChunk {
  stream: 'out' | 'err'
  text: string
}

/** Everything that happened when one line was entered at the prompt. */
export interface CommandRecord {
  line: string
  /** The prompt the line was typed at. */
  prompt: string
  host: string
  /** Working directory and effective user before the line ran. */
  cwd: string
  euid: number
  /** In-game time when the line ran. */
  time: number
  output: OutputChunk[]
  status: number
  /** Each simple command that ran, including those inside scripts. */
  commands: CommandInfo[]
  /** Every file the line read, listed or changed. */
  accesses: AccessEvent[]
  /** The screen should be wiped before this record's output is shown. */
  clear: boolean
  /** The output should be shown a screenful at a time. */
  page: boolean
}

export interface ShellOptions {
  host: Host
  programs: ProgramRegistry
  /** Account to log in as. Must exist on the host. */
  user: string
  /** Terminal name, such as `ttyp2`. */
  tty?: string
}

/** Plain-data form of a session, for saves. */
export interface SerializedShell {
  tty: string | null
  history: string[]
  frames: {
    cred: Credentials
    ruid: number
    cwd: string
    vars: [string, string][]
  }[]
}

/**
 * An interactive login session on one host. It is a stack of shells: running
 * `sh` (or a setuid copy of it) pushes a new shell on top, and `exit` pops it.
 */
export class Shell {
  readonly host: Host
  readonly history: string[] = []
  private readonly programs: ProgramRegistry
  private frames: ShellEnv[] = []

  private constructor(host: Host, programs: ProgramRegistry) {
    this.host = host
    this.programs = programs
  }

  /** Log in as a user and start their login shell in their home directory. */
  static login(options: ShellOptions): Shell {
    const { host } = options
    const user = host.users.byName(options.user)
    const cred = host.users.credentialsFor(options.user)
    if (!user || !cred) throw new Error(`no such user on ${host.name}: ${options.user}`)

    let canEnterHome = false
    try {
      canEnterHome =
        host.fs.tryStat(user.home, cred)?.kind === 'dir' && host.fs.access(user.home, cred, 'x')
    } catch {
      // Home is somewhere this user cannot reach: start at the root instead.
    }

    const shell = new Shell(host, options.programs)
    shell.frames.push(
      shell.frame(
        cred,
        cred.uid,
        canEnterHome ? user.home : '/',
        new Map([
          ['HOME', user.home],
          ['USER', user.name],
          ['PATH', DEFAULT_PATH],
          ['SHELL', user.shell],
        ]),
        options.tty ?? null,
      ),
    )
    return shell
  }

  private frame(
    cred: Credentials,
    ruid: number,
    cwd: string,
    vars: Map<string, string>,
    tty: string | null,
  ): ShellEnv {
    return {
      host: this.host,
      programs: this.programs,
      cred,
      ruid,
      cwd,
      vars,
      positional: [],
      scriptName: 'sh',
      tty,
      interactive: true,
      depth: 0,
      lastStatus: 0,
      history: this.history,
    }
  }

  /** The shell currently reading the keyboard. */
  get env(): ShellEnv {
    return this.frames[this.frames.length - 1]!
  }

  get cwd(): string {
    return this.env.cwd
  }

  /** Effective user id of the current shell. */
  get euid(): number {
    return this.env.cred.uid
  }

  /** Effective user name of the current shell. */
  get user(): string {
    return this.host.users.userName(this.euid)
  }

  /** How many shells deep the session is. 1 is the login shell. */
  get depth(): number {
    return this.frames.length
  }

  /** `granite$ ` for ordinary users and `granite# ` for root, the classic warning sign. */
  get prompt(): string {
    return `${this.host.name}${this.euid === 0 ? '#' : '$'} `
  }

  /** Run one line as if typed at the prompt. */
  run(line: string): CommandRecord {
    const env = this.env
    const record: CommandRecord = {
      line,
      prompt: this.prompt,
      host: this.host.name,
      cwd: env.cwd,
      euid: env.cred.uid,
      time: this.host.clock.now,
      output: [],
      status: 0,
      commands: [],
      accesses: [],
      clear: false,
      page: false,
    }

    const write = (stream: 'out' | 'err', text: string): void => {
      const last = record.output[record.output.length - 1]
      if (last && last.stream === stream) last.text += text
      else record.output.push({ stream, text })
    }

    if (line.trim() !== '') this.history.push(line)

    let push: Credentials | undefined
    let pop = false
    const stopWatching = this.host.fs.subscribe((event) => record.accesses.push(event))
    env.onCommand = (info) => record.commands.push(info)
    try {
      const result = execute(env, line, {
        stdin: '',
        stdinIsTTY: true,
        stdoutIsTTY: true,
        out: (text) => write('out', text),
        err: (text) => write('err', text),
        onEffect: (effect) => {
          if (effect.type === 'clear') {
            record.output = []
            record.clear = true
          } else if (effect.type === 'page') {
            record.page = true
          } else if (effect.type === 'shell') {
            push = effect.cred
          } else {
            pop = true
          }
        },
      })
      record.status = result.status
    } finally {
      stopWatching()
      delete env.onCommand
    }

    if (pop) {
      if (this.frames.length > 1) this.frames.pop()
      else write('err', 'exit: this is your login shell. There is nothing to exit to.\n')
    } else if (push) {
      this.frames.push(this.frame(push, env.ruid, env.cwd, new Map(env.vars), env.tty))
    }
    return record
  }

  serialize(): SerializedShell {
    return {
      tty: this.env.tty,
      history: [...this.history],
      frames: this.frames.map((f) => ({
        cred: { uid: f.cred.uid, gid: f.cred.gid, groups: [...f.cred.groups] },
        ruid: f.ruid,
        cwd: f.cwd,
        vars: [...f.vars.entries()],
      })),
    }
  }

  /** Rebuild a saved session on a host that has already been restored. */
  static restore(data: SerializedShell, host: Host, programs: ProgramRegistry): Shell {
    const shell = new Shell(host, programs)
    shell.history.push(...data.history)
    shell.frames = data.frames.map((f) =>
      shell.frame(f.cred, f.ruid, f.cwd, new Map(f.vars), data.tty),
    )
    if (shell.frames.length === 0) throw new Error('saved session has no shells')
    return shell
  }
}

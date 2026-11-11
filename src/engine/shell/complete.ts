import { resolve } from '../vfs/index.ts'
import { commandNames, type ShellEnv } from './exec.ts'

export interface Completion {
  /** The whole line after completion. Unchanged when nothing could be added. */
  line: string
  /** Where the cursor belongs in the new line. */
  cursor: number
  /** The choices, when there is more than one. Directories end in a slash. */
  candidates: string[]
}

const WORD_BREAK = /[ \t|;<>]/

function commonPrefix(names: string[]): string {
  let prefix = names[0] ?? ''
  for (const name of names) {
    while (!name.startsWith(prefix)) prefix = prefix.slice(0, -1)
  }
  return prefix
}

/** The directory a typed prefix such as `~/logs/` or `../adm/` refers to. */
function lookupDir(env: ShellEnv, typed: string): string {
  if (typed === '') return env.cwd
  if (typed.startsWith('~')) {
    const slash = typed.indexOf('/')
    const user = typed.slice(1, slash)
    const home = user === '' ? env.vars.get('HOME') : env.host.users.byName(user)?.home
    if (home !== undefined) return resolve(home, '.' + typed.slice(slash))
  }
  return resolve(env.cwd, typed)
}

/**
 * Tab completion. The word under the cursor is completed as a command name
 * when it is the first word of a command, and as a file name otherwise. With
 * one match the word is finished; with several it is extended as far as they
 * agree and the choices are returned for display.
 */
export function completeLine(env: ShellEnv, line: string, cursor: number): Completion {
  const before = line.slice(0, cursor)
  const after = line.slice(cursor)

  let start = before.length
  while (start > 0 && !WORD_BREAK.test(before[start - 1]!)) start--
  const word = before.slice(start)
  const lead = before.slice(0, start).trimEnd()
  const isCommand = (lead === '' || lead.endsWith('|') || lead.endsWith(';')) && !word.includes('/')

  let typedDir = ''
  let matches: { name: string; isDir: boolean }[]

  if (isCommand) {
    matches = commandNames(env)
      .filter((name) => name.startsWith(word))
      .map((name) => ({ name, isDir: false }))
  } else {
    const slash = word.lastIndexOf('/')
    typedDir = word.slice(0, slash + 1)
    const prefix = word.slice(slash + 1)
    const dir = lookupDir(env, typedDir)
    let names: string[]
    try {
      names = env.host.fs.readdir(dir, env.cred)
    } catch {
      names = []
    }
    matches = names
      .filter((name) => name.startsWith(prefix))
      // Hidden files are offered only when the dot has been typed.
      .filter((name) => prefix.startsWith('.') || !name.startsWith('.'))
      .map((name) => {
        let isDir = false
        try {
          isDir = env.host.fs.tryStat(resolve(dir, name), env.cred)?.kind === 'dir'
        } catch {
          // Cannot look at it: offer the name anyway.
        }
        return { name, isDir }
      })
  }

  if (matches.length === 0) return { line, cursor, candidates: [] }

  let completed: string
  let candidates: string[] = []
  if (matches.length === 1) {
    const only = matches[0]!
    // A finished directory gets a slash so the next Tab looks inside it; a
    // finished file or command gets a space, ready for the next word.
    const suffix = only.isDir ? '/' : after.startsWith(' ') ? '' : ' '
    completed = typedDir + only.name + suffix
  } else {
    completed = typedDir + commonPrefix(matches.map((m) => m.name))
    candidates = matches.map((m) => (m.isDir ? `${m.name}/` : m.name))
  }

  return {
    line: line.slice(0, start) + completed + after,
    cursor: start + completed.length,
    candidates,
  }
}

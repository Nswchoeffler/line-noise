import type { Credentials, Vfs } from '../vfs/index.ts'
import type { Host } from '../world/host.ts'

/** Something a command asks the terminal or the session to do. */
export type Effect =
  /** Wipe the screen. */
  | { type: 'clear' }
  /** Show this command's output one screenful at a time. */
  | { type: 'page' }
  /** Start an interactive shell with these credentials on top of the current one. */
  | { type: 'shell'; cred: Credentials }
  /** Leave the current interactive shell. */
  | { type: 'exit' }

export interface ProgramResult {
  stdout: string
  stderr: string
  /** 0 for success. Anything else is a failure, as on Unix. */
  status: number
  effects?: Effect[]
}

/** Everything a command can see. Commands keep no state of their own. */
export interface ProgramContext {
  /** The name the command was run as. */
  name: string
  /** Arguments after the name, already expanded by the shell. */
  args: string[]
  /** Text piped or redirected in. Empty when `stdinIsTTY`. */
  stdin: string
  /** True when nothing was piped in: input would come from the keyboard. */
  stdinIsTTY: boolean
  /** True when output goes straight to the screen, not a pipe or a file. */
  stdoutIsTTY: boolean
  cwd: string
  /** Effective credentials: who the filesystem thinks is asking. */
  cred: Credentials
  /** Real user id: who actually logged in. Differs from `cred.uid` under setuid. */
  ruid: number
  host: Host
  fs: Vfs
  /** The terminal this shell is attached to (`ttyp2`), or null for system jobs. */
  tty: string | null
  /** Value of a shell variable, such as `HOME`. */
  variable: (name: string) => string | undefined
  /** Turn a path as typed into an absolute path. */
  resolve: (path: string) => string
  /** Run shell source with this command's credentials. */
  runScript: (source: string, args: string[], stdin: string) => ProgramResult
  /** The commands this shell can find, for `help`. */
  programs: ProgramRegistry
}

export interface Program {
  name: string
  /** Where the program file is installed, such as `/bin/ls`. */
  path: string
  /** One line for `help`. */
  summary: string
  /** Shown after an option error, such as `ls [-la] [file ...]`. */
  usage: string
  run: (ctx: ProgramContext) => ProgramResult
}

export type ProgramRegistry = ReadonlyMap<string, Program>

/** Thrown by a command for bad options. The shell adds the usage line. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

/** One simple command that ran, recorded so levels can ask what the player did. */
export interface CommandInfo {
  /** Name and arguments after expansion. */
  argv: string[]
  /** The program file that ran, or null for a shell builtin or a failed lookup. */
  path: string | null
  status: number
  /** Effective user id the command ran with. */
  euid: number
  /** 0 for a command typed at the prompt, higher inside scripts. */
  depth: number
}

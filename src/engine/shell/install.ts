import type { Vfs } from '../vfs/index.ts'
import type { ProgramRegistry } from './types.ts'

/** A plausible, stable file size for a compiled program, derived from its name. */
function programSize(name: string): number {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 9973
  return 8192 + (hash % 24) * 1024
}

/**
 * Put each program's file where it belongs (`/bin/ls` and so on), owned by
 * root and executable by everyone. Commands only exist on a host once this
 * has run: the shell finds them by searching the filesystem.
 */
export function installPrograms(fs: Vfs, programs: ProgramRegistry, mtime?: number): void {
  for (const program of programs.values()) {
    fs.install(program.path, {
      program: program.name,
      size: programSize(program.name),
      mode: 0o755,
      uid: 0,
      gid: 0,
      ...(mtime === undefined ? {} : { mtime }),
    })
  }
}

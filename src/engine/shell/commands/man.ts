import { VfsError } from '../../vfs/index.ts'
import type { Program } from '../types.ts'

/** Manual pages are ordinary files: /usr/man/man1/ls.1, /usr/man/man8/atrun.8, … */
export const MANUAL_ROOT = '/usr/man'
const SECTIONS = ['1', '2', '3', '4', '5', '6', '7', '8']

export const man: Program = {
  name: 'man',
  path: '/usr/ucb/man',
  summary: 'read the manual page for a command',
  usage: 'man [section] name',
  run(ctx) {
    const args = ctx.args.filter((a) => !a.startsWith('-'))
    if (args.length === 0) {
      return { stdout: '', stderr: 'What manual page do you want? Try: man ls\n', status: 1 }
    }

    // "man 8 atrun" looks only in section 8.
    const sectionGiven = args.length > 1 && SECTIONS.includes(args[0]!)
    const sections = sectionGiven ? [args[0]!] : SECTIONS
    const names = sectionGiven ? args.slice(1) : args

    let stdout = ''
    let stderr = ''
    for (const name of names) {
      let page: string | undefined
      for (const section of sections) {
        try {
          page = ctx.fs.readFile(`${MANUAL_ROOT}/man${section}/${name}.${section}`, ctx.cred)
          break
        } catch (err) {
          if (!(err instanceof VfsError)) throw err
        }
      }
      if (page === undefined) stderr += `No manual entry for ${name}.\n`
      else stdout += page.endsWith('\n') ? page : page + '\n'
    }

    return {
      stdout,
      stderr,
      status: stderr === '' ? 0 : 1,
      ...(ctx.stdoutIsTTY && stdout !== '' ? { effects: [{ type: 'page' as const }] } : {}),
    }
  },
}

import { VfsError } from '../../vfs/index.ts'
import { LOGIN_RECORDS_PATH, parseLogins, type LoginRecord } from '../../world/logins.ts'
import {
  formatClock,
  formatDuration,
  formatLoginTime,
  formatShortTime,
} from '../../world/time.ts'
import { UsageError, type Program, type ProgramContext } from '../types.ts'

/**
 * Read the login records with the caller's own permissions. A host with no
 * records file simply has no logins to report.
 */
export function readLogins(ctx: ProgramContext): LoginRecord[] {
  try {
    return parseLogins(ctx.fs.readFile(LOGIN_RECORDS_PATH, ctx.cred))
  } catch (err) {
    if (err instanceof VfsError && err.code === 'ENOENT') return []
    throw err
  }
}

export const who: Program = {
  name: 'who',
  path: '/bin/who',
  summary: 'list who is logged in right now',
  usage: 'who    or    who am i',
  run(ctx) {
    let sessions = readLogins(ctx).filter((r) => r.logout === undefined)
    if (ctx.args.join(' ') === 'am i') {
      sessions = sessions.filter((r) => r.tty === ctx.tty)
    } else if (ctx.args.length > 0) {
      throw new UsageError('takes no arguments, except "am i"')
    }

    const stdout = sessions
      .map((r) => {
        const line = `${r.user.padEnd(8)} ${r.tty.padEnd(8)} ${formatShortTime(r.login)}`
        return (r.from === '' ? line : `${line}   (${r.from})`) + '\n'
      })
      .join('')
    return { stdout, stderr: '', status: 0 }
  },
}

export const last: Program = {
  name: 'last',
  path: '/usr/ucb/last',
  summary: 'list past logins, newest first',
  usage: 'last [-count] [user or terminal ...]',
  run(ctx) {
    let limit = Infinity
    const names: string[] = []
    for (const arg of ctx.args) {
      if (/^-\d+$/.test(arg)) limit = Number(arg.slice(1))
      else if (arg.startsWith('-')) throw new UsageError(`unknown option ${arg}`)
      else names.push(arg)
    }

    const records = readLogins(ctx)
    const shown = records
      .filter((r) => names.length === 0 || names.includes(r.user) || names.includes(r.tty))
      // Newest first. The sort is stable, so equal times keep their file order.
      .toSorted((a, b) => b.login - a.login)
      .slice(0, limit)

    let stdout = shown
      .map((r) => {
        const start = `${r.user.padEnd(8)}  ${r.tty.padEnd(8)} ${r.from.padEnd(16)} ${formatLoginTime(r.login)}`
        const end =
          r.logout === undefined
            ? '   still logged in'
            : ` - ${formatClock(r.logout)}  (${formatDuration(r.logout - r.login)})`
        return start + end + '\n'
      })
      .join('')

    if (records.length > 0) {
      const earliest = Math.min(...records.map((r) => r.login))
      stdout += `\nwtmp begins ${formatLoginTime(earliest)}\n`
    }
    return { stdout, stderr: '', status: 0 }
  },
}

import type { LoginRecord } from '../../world/logins.ts'
import { formatLoginTime, formatShortTime, yearOf } from '../../world/time.ts'
import type { User } from '../../world/users.ts'
import type { Program, ProgramContext } from '../types.ts'
import { readLogins } from './who.ts'

/** The full name is the first comma-separated part of the account's details field. */
const realName = (user: User): string => user.gecos.split(',')[0] ?? ''

function describe(ctx: ProgramContext, user: User, logins: LoginRecord[]): string {
  const mine = logins.filter((r) => r.user === user.name)
  const current = mine.filter((r) => r.logout === undefined)
  const latest = mine.toSorted((a, b) => b.login - a.login)[0]

  let out = `${`Login name: ${user.name}`.padEnd(40)}In real life: ${realName(user)}\n`
  out += `${`Directory: ${user.home}`.padEnd(40)}Shell: ${user.shell}\n`

  if (current.length > 0) {
    for (const r of current) {
      out += `On since ${formatShortTime(r.login)} on ${r.tty}${r.from === '' ? '' : ` from ${r.from}`}\n`
    }
  } else if (latest) {
    // The year is only worth printing when it is not this year.
    const year = yearOf(latest.login)
    const when = formatLoginTime(latest.login) + (year === yearOf(ctx.host.clock.now) ? '' : ` ${year}`)
    out += `Last login ${when} on ${latest.tty}${latest.from === '' ? '' : ` from ${latest.from}`}\n`
  } else {
    out += 'Never logged in.\n'
  }

  // A user's ~/.plan is their note to the world. It is read with the caller's
  // permissions, so a private plan stays private.
  let plan: string | undefined
  try {
    plan = ctx.fs.readFile(`${user.home}/.plan`, ctx.cred)
  } catch {
    plan = undefined
  }
  out += plan === undefined ? 'No Plan.\n' : `Plan:\n${plan}${plan.endsWith('\n') ? '' : '\n'}`
  return out
}

export const finger: Program = {
  name: 'finger',
  path: '/usr/ucb/finger',
  summary: 'show details about a user, or about everyone logged in',
  usage: 'finger [user ...]',
  run(ctx) {
    const names = ctx.args.filter((a) => !a.startsWith('-'))
    const logins = readLogins(ctx)
    const users = ctx.host.users

    if (names.length === 0) {
      let stdout = `${'Login'.padEnd(9)}${'Name'.padEnd(22)}${'TTY'.padEnd(9)}When\n`
      for (const r of logins.filter((l) => l.logout === undefined)) {
        const user = users.byName(r.user)
        stdout +=
          r.user.padEnd(9) +
          (user ? realName(user) : '???').padEnd(22) +
          r.tty.padEnd(9) +
          formatShortTime(r.login) +
          '\n'
      }
      return { stdout, stderr: '', status: 0 }
    }

    const sections: string[] = []
    let stderr = ''
    for (const name of names) {
      const user = users.byName(name)
      if (user) sections.push(describe(ctx, user, logins))
      else stderr += `finger: ${name}: no such user\n`
    }
    return { stdout: sections.join('\n'), stderr, status: stderr === '' ? 0 : 1 }
  },
}

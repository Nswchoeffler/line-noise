import { UsageError, type Program } from '../types.ts'

export const ps: Program = {
  name: 'ps',
  path: '/bin/ps',
  summary: 'list running programs',
  usage: 'ps [-aux]    (a: everyone, x: background jobs too, u: show owners)',
  run(ctx) {
    // Options are accepted with or without a dash, and in any grouping:
    // "ps -a -x", "ps -ax" and "ps aux" all work. The System V spelling
    // "-ef" is understood as "everything, with owners".
    const letters = new Set(ctx.args.join('').replace(/-/g, ''))
    for (const letter of letters) {
      if (!'axuefl'.includes(letter)) throw new UsageError(`unknown option ${letter}`)
    }
    const everyone = letters.has('a') || letters.has('e')
    const background = letters.has('x') || letters.has('e')
    const owners = letters.has('u') || letters.has('f')

    const shown = ctx.host.processes
      .filter((p) => everyone || p.uid === ctx.ruid)
      .filter((p) => background || p.tty !== null)
      .toSorted((a, b) => a.pid - b.pid)

    let stdout = owners ? 'USER       PID TT STAT  TIME COMMAND\n' : '  PID TT STAT  TIME COMMAND\n'
    for (const p of shown) {
      const row = `${String(p.pid).padStart(5)} ${(p.tty ?? '?').padEnd(2)} ${p.stat.padEnd(4)} ${p.time.padStart(5)} ${p.command}\n`
      stdout += owners ? `${ctx.host.users.userName(p.uid).padEnd(8)} ${row}` : row
    }
    return { stdout, stderr: '', status: 0 }
  },
}

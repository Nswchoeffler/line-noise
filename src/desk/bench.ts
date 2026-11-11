// A bare, story-free host for trying the terminal on its own. It is what the
// end-to-end tests of the terminal run against, at the address "?bench".
// The game itself never uses it.

import { programs } from '../engine/shell/commands/index.ts'
import { Shell } from '../engine/shell/session.ts'
import { buildHost } from '../engine/world/build.ts'
import { HostSpecSchema, parseSpec } from '../engine/world/spec.ts'
import { parseTime } from '../engine/world/time.ts'
import { World } from '../engine/world/world.ts'

const longFile = Array.from({ length: 60 }, (_, i) => `This is line ${i + 1} of a long file.\n`).join('')

const BENCH_HOST = {
  name: 'bench',
  timezone: 'PDT',
  installed: '1985-03-01 12:00',
  groups: [
    { name: 'wheel', gid: 0, members: ['root'] },
    { name: 'staff', gid: 10 },
  ],
  users: [
    { name: 'root', uid: 0, group: 'wheel', gecos: 'System Administrator', home: '/' },
    { name: 'ops', uid: 100, group: 'staff', gecos: 'Systems Manager' },
  ],
  dirs: [{ path: '/tmp', mode: '1777' }],
  files: [
    { path: '/home/ops/notes', owner: 'ops', content: 'Remember to check the logs.\n' },
    { path: '/home/ops/long.txt', owner: 'ops', content: longFile },
    { path: '/home/ops/usage.log', owner: 'ops', content: 'ops ttyp0 08:02 600\n' },
    { path: '/home/ops/usage.old', owner: 'ops', content: 'ops ttyp0 07:55 300\n' },
    { path: '/usr/man/man1/ls.1', content: 'LS(1)\n\nNAME\n     ls - list files\n' },
  ],
  logins: [{ user: 'ops', tty: 'ttyp0', login: '1986-09-09 08:02' }],
  processes: [
    { pid: 1, user: 'root', command: 'init' },
    { pid: 412, user: 'ops', tty: 'p0', command: '-sh' },
  ],
}

export function benchShell(): Shell {
  const world = new World(parseTime('1986-09-09 08:15'))
  const spec = parseSpec(HostSpecSchema, BENCH_HOST, 'bench host')
  const host = world.add(buildHost(spec, { clock: world.clock, programs }))
  return Shell.login({ host, programs, user: 'ops', tty: 'ttyp0' })
}

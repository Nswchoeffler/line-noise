// A small, story-free host for unit tests. Not used by the game itself.

import { Clock } from '../world/clock.ts'
import { Host } from '../world/host.ts'
import { parseTime } from '../world/time.ts'
import { programs } from './commands/index.ts'
import { installPrograms } from './install.ts'
import { Shell, type CommandRecord } from './session.ts'

/** Tuesday 9 September 1986, 08:15:00. */
export const T0 = parseTime('1986-09-09 08:15:00')

const PASSWD = [
  'root:Zk3v9QpLm2xYw:0:0:System Administrator:/:/bin/sh',
  'alice:Ab1cD2eF3gH4i:101:10:Alice Example:/home/alice:/bin/sh',
  'bob:Bc2dE3fG4hI5j:102:10:Bob Example:/home/bob:/bin/sh',
  'carol:Cd3eF4gH5iJ6k:103:30:Carol Example:/home/carol:/bin/sh',
  '',
].join('\n')

const GROUP = ['wheel:*:0:root', 'staff:*:10:', 'guest:*:30:', ''].join('\n')

export interface Output {
  stdout: string
  stderr: string
  status: number
  record: CommandRecord
}

export interface Session {
  shell: Shell
  /** Run a line and split its output by stream. */
  run: (line: string) => Output
}

export interface Fixture extends Session {
  host: Host
  clock: Clock
  /** Start another session as a different user. */
  login: (user: string, tty?: string) => Session
}

function session(host: Host, user: string, tty: string): Session {
  const shell = Shell.login({ host, programs, user, tty })
  return {
    shell,
    run(line) {
      const record = shell.run(line)
      const collect = (stream: 'out' | 'err'): string =>
        record.output
          .filter((c) => c.stream === stream)
          .map((c) => c.text)
          .join('')
      return { stdout: collect('out'), stderr: collect('err'), status: record.status, record }
    },
  }
}

/**
 * A host with four accounts (root, alice, bob, carol), home directories, a
 * sticky /tmp and every engine command installed. The default session is
 * alice's. Alice and bob share the group `staff`; carol is in `guest`.
 */
export function fixture(): Fixture {
  const clock = new Clock(T0)
  const host = new Host({ name: 'testhost', clock, timezone: 'PDT' })
  const installed = parseTime('1985-03-01 12:00')

  host.fs.install('/etc/passwd', { content: PASSWD, mode: 0o644, mtime: installed })
  host.fs.install('/etc/group', { content: GROUP, mode: 0o644, mtime: installed })
  host.fs.installDir('/tmp', { mode: 0o1777 })
  host.fs.installDir('/usr/adm', { mode: 0o755 })
  for (const [name, uid, gid] of [
    ['alice', 101, 10],
    ['bob', 102, 10],
    ['carol', 103, 30],
  ] as const) {
    host.fs.installDir(`/home/${name}`, { uid, gid, mode: 0o755 })
  }
  installPrograms(host.fs, programs, installed)

  return {
    host,
    clock,
    ...session(host, 'alice', 'ttyp0'),
    login: (user, tty = 'ttyp1') => session(host, user, tty),
  }
}

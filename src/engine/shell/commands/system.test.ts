// date, who, last, finger, ps, man and history: asking the system about itself.

import { beforeEach, describe, expect, it } from 'vitest'
import { formatLogins, LOGIN_RECORDS_PATH } from '../../world/logins.ts'
import { parseTime } from '../../world/time.ts'
import { fixture, type Fixture } from '../testing.ts'

let t: Fixture

const at = (text: string): number => parseTime(text)

beforeEach(() => {
  t = fixture()
  t.host.fs.install(LOGIN_RECORDS_PATH, {
    mode: 0o644,
    content: formatLogins([
      { user: 'carol', tty: 'ttyh1', from: '', login: at('1985-08-26 14:10'), logout: at('1985-08-26 15:00') },
      { user: 'bob', tty: 'ttyh2', from: '', login: at('1986-09-08 09:00'), logout: at('1986-09-08 17:30') },
      { user: 'bob', tty: 'ttyh3', from: 'farnet', login: at('1986-09-09 02:14'), logout: at('1986-09-09 02:51') },
      { user: 'root', tty: 'console', from: '', login: at('1986-09-07 22:00'), logout: at('1986-09-09 01:05') },
      { user: 'alice', tty: 'ttyp0', from: '', login: at('1986-09-09 08:02') },
      { user: 'bob', tty: 'ttyh2', from: 'farnet', login: at('1986-09-09 08:10') },
    ]),
  })
  t.host.processes = [
    { pid: 1, uid: 0, tty: null, stat: 'S', time: '0:04', command: 'init' },
    { pid: 58, uid: 0, tty: null, stat: 'S', time: '1:12', command: '/etc/cron' },
    { pid: 412, uid: 101, tty: 'p0', stat: 'S', time: '0:01', command: '-sh' },
    { pid: 430, uid: 102, tty: 'h2', stat: 'R', time: '0:09', command: 'grep -i secret /usr/spool/mail/alice' },
  ]
})

describe('date', () => {
  it('prints the in-game time with the host time zone', () => {
    expect(t.run('date').stdout).toBe('Tue Sep  9 08:15:00 PDT 1986\n')
  })

  it('follows the in-game clock', () => {
    t.clock.advance(6 * 60 + 5)
    expect(t.run('date').stdout).toBe('Tue Sep  9 08:21:05 PDT 1986\n')
  })

  it('works in a pipe', () => {
    expect(t.run('date | wc -l').stdout.trim()).toBe('1')
  })
})

describe('who', () => {
  it('lists open sessions with terminal, time and origin', () => {
    expect(t.run('who').stdout).toBe(
      'alice    ttyp0    Sep  9 08:02\nbob      ttyh2    Sep  9 08:10   (farnet)\n',
    )
  })

  it('answers "who am i" with the current terminal only', () => {
    expect(t.run('who am i').stdout).toBe('alice    ttyp0    Sep  9 08:02\n')
  })

  it('can be counted and filtered', () => {
    expect(t.run('who | wc -l').stdout.trim()).toBe('2')
    expect(t.run('who | grep -c farnet').stdout).toBe('1\n')
  })

  it('prints nothing on a host with no login records', () => {
    t.host.fs.unlink(LOGIN_RECORDS_PATH, { uid: 0, gid: 0, groups: [0] })
    expect(t.run('who')).toMatchObject({ stdout: '', status: 0 })
  })

  it('needs permission to read the records', () => {
    t.host.fs.chmod(LOGIN_RECORDS_PATH, 0o600, { uid: 0, gid: 0, groups: [0] })
    expect(t.run('who').stderr).toBe('who: /usr/adm/wtmp: Permission denied\n')
    expect(t.login('root').run('who').status).toBe(0)
  })

  it('rejects other arguments', () => {
    expect(t.run('who is there').stderr).toContain('usage: who')
  })
})

describe('last', () => {
  it('lists logins newest first, with length, and says where the records begin', () => {
    expect(t.run('last').stdout).toBe(
      [
        'bob       ttyh2    farnet           Tue Sep  9 08:10   still logged in',
        'alice     ttyp0                     Tue Sep  9 08:02   still logged in',
        'bob       ttyh3    farnet           Tue Sep  9 02:14 - 02:51  (00:37)',
        'bob       ttyh2                     Mon Sep  8 09:00 - 17:30  (08:30)',
        'root      console                   Sun Sep  7 22:00 - 01:05  (1+03:05)',
        'carol     ttyh1                     Mon Aug 26 14:10 - 15:00  (00:50)',
        '',
        'wtmp begins Mon Aug 26 14:10',
        '',
      ].join('\n'),
    )
  })

  it('filters by user', () => {
    const lines = t.run('last bob').stdout.split('\n')
    expect(lines.filter((l) => l.startsWith('bob'))).toHaveLength(3)
    expect(lines.some((l) => l.startsWith('alice'))).toBe(false)
  })

  it('filters by terminal', () => {
    expect(t.run('last ttyh3').stdout).toContain('bob       ttyh3    farnet')
    expect(t.run('last ttyh3 | grep -c bob').stdout).toBe('1\n')
  })

  it('limits the count with -N', () => {
    expect(t.run('last -2 | grep -c logged').stdout).toBe('2\n')
    expect(t.run('last -1 bob').stdout).toMatch(/^bob {7}ttyh2 {4}farnet .*still logged in\n\nwtmp begins/)
  })

  it('shows only the footer for a user with no logins', () => {
    expect(t.run('last nobody').stdout).toBe('\nwtmp begins Mon Aug 26 14:10\n')
  })

  it('reflects edits to the records file, since it is only a file', () => {
    const root = t.login('root')
    root.run('grep -v farnet /usr/adm/wtmp > /tmp/clean; cp /tmp/clean /usr/adm/wtmp')
    expect(t.run('last | grep -c farnet').stdout).toBe('0\n')
  })

  it('rejects unknown options', () => {
    expect(t.run('last -x').stderr).toContain('unknown option -x')
  })
})

describe('finger', () => {
  beforeEach(() => {
    t.host.fs.install('/home/carol/.plan', {
      content: 'On sabbatical until next autumn.\n',
      uid: 103,
      gid: 30,
      mode: 0o644,
    })
  })

  it('lists everyone logged in when given no name', () => {
    expect(t.run('finger').stdout).toBe(
      [
        'Login    Name                  TTY      When',
        'alice    Alice Example         ttyp0    Sep  9 08:02',
        'bob      Bob Example           ttyh2    Sep  9 08:10',
        '',
      ].join('\n'),
    )
  })

  it('describes a user who is logged in', () => {
    expect(t.run('finger bob').stdout).toBe(
      [
        'Login name: bob                         In real life: Bob Example',
        'Directory: /home/bob                    Shell: /bin/sh',
        'On since Sep  9 08:10 on ttyh2 from farnet',
        'No Plan.',
        '',
      ].join('\n'),
    )
  })

  it('shows the last login, with the year when it was not this year, and the plan', () => {
    expect(t.run('finger carol').stdout).toBe(
      [
        'Login name: carol                       In real life: Carol Example',
        'Directory: /home/carol                  Shell: /bin/sh',
        'Last login Mon Aug 26 14:10 1985 on ttyh1',
        'Plan:',
        'On sabbatical until next autumn.',
        '',
      ].join('\n'),
    )
  })

  it('says so when a user has never logged in', () => {
    t.host.fs.unlink(LOGIN_RECORDS_PATH, { uid: 0, gid: 0, groups: [0] })
    expect(t.run('finger carol').stdout).toContain('Never logged in.\n')
  })

  it('keeps a private plan private', () => {
    t.host.fs.chmod('/home/carol/.plan', 0o600, { uid: 0, gid: 0, groups: [0] })
    expect(t.run('finger carol').stdout).toContain('No Plan.\n')
    expect(t.login('carol').run('finger carol').stdout).toContain('On sabbatical')
  })

  it('describes several users and reports unknown ones', () => {
    const result = t.run('finger alice ghost bob')
    expect(result.stdout).toContain('Login name: alice')
    expect(result.stdout).toContain('Login name: bob')
    expect(result.stderr).toBe('finger: ghost: no such user\n')
    expect(result.status).toBe(1)
  })
})

describe('ps', () => {
  it('lists the caller\'s own terminal processes by default', () => {
    expect(t.run('ps').stdout).toBe('  PID TT STAT  TIME COMMAND\n  412 p0 S     0:01 -sh\n')
  })

  it('lists every terminal process with -a', () => {
    expect(t.run('ps -a').stdout).toBe(
      [
        '  PID TT STAT  TIME COMMAND',
        '  412 p0 S     0:01 -sh',
        '  430 h2 R     0:09 grep -i secret /usr/spool/mail/alice',
        '',
      ].join('\n'),
    )
  })

  it('adds background jobs with x and owners with u', () => {
    expect(t.run('ps -aux').stdout).toBe(
      [
        'USER       PID TT STAT  TIME COMMAND',
        'root         1 ?  S     0:04 init',
        'root        58 ?  S     1:12 /etc/cron',
        'alice      412 p0 S     0:01 -sh',
        'bob        430 h2 R     0:09 grep -i secret /usr/spool/mail/alice',
        '',
      ].join('\n'),
    )
  })

  it.each(['ps aux', 'ps -a -u -x', 'ps -ef'])('%s means the same as ps -aux', (line) => {
    expect(t.run(line).stdout).toBe(t.run('ps -aux').stdout)
  })

  it('can be searched', () => {
    expect(t.run('ps -aux | grep -c bob').stdout).toBe('1\n')
  })

  it('still reports the real user inside a setuid shell', () => {
    t.host.fs.install('/tmp/rootsh', { program: 'sh', mode: 0o4755, uid: 0 })
    t.run('/tmp/rootsh')
    expect(t.run('ps').stdout).toContain('412 p0')
  })

  it('rejects unknown options', () => {
    expect(t.run('ps -z').stderr).toContain('unknown option z')
  })
})

describe('man', () => {
  beforeEach(() => {
    t.host.fs.install('/usr/man/man1/ls.1', { content: 'LS(1)\n\nls - list files\n', mode: 0o644 })
    t.host.fs.install('/usr/man/man8/atrun.8', { content: 'ATRUN(8)\n\natrun - run jobs\n', mode: 0o644 })
    t.host.fs.install('/usr/man/man1/atrun.1', { content: 'ATRUN(1)\n', mode: 0o644 })
  })

  it('prints a page and asks the terminal to page it', () => {
    const result = t.run('man ls')
    expect(result.stdout).toBe('LS(1)\n\nls - list files\n')
    expect(result.record.page).toBe(true)
  })

  it('finds pages in later sections, taking the first section that has one', () => {
    t.host.fs.unlink('/usr/man/man1/atrun.1', { uid: 0, gid: 0, groups: [0] })
    expect(t.run('man atrun').stdout).toContain('ATRUN(8)')
  })

  it('looks only in the section asked for', () => {
    expect(t.run('man atrun').stdout).toBe('ATRUN(1)\n')
    expect(t.run('man 8 atrun').stdout).toContain('ATRUN(8)')
    expect(t.run('man 8 ls').stderr).toBe('No manual entry for ls.\n')
  })

  it('reports a missing page', () => {
    const result = t.run('man frobnicate')
    expect(result.stderr).toBe('No manual entry for frobnicate.\n')
    expect(result.status).toBe(1)
    expect(result.record.page).toBe(false)
  })

  it('asks what is wanted when given no name', () => {
    expect(t.run('man').stderr).toBe('What manual page do you want? Try: man ls\n')
  })

  it('can be piped and searched without paging', () => {
    const result = t.run('man ls | grep -c list')
    expect(result.stdout).toBe('1\n')
    expect(result.record.page).toBe(false)
  })
})

describe('history', () => {
  it('numbers the lines typed so far, including itself', () => {
    t.run('pwd')
    t.run('date')
    expect(t.run('history').stdout).toBe('    1  pwd\n    2  date\n    3  history\n')
  })

  it('can be searched, and the search finds its own line too', () => {
    t.run('ls -l /etc')
    t.run('pwd')
    expect(t.run('history | grep etc').stdout).toBe(
      '    1  ls -l /etc\n    3  history | grep etc\n',
    )
  })
})

describe('every engine command', () => {
  it('is installed, listed by help with a summary, and has a usage line', async () => {
    const { programs } = await import('./index.ts')
    const help = t.run('help').stdout
    for (const program of programs.values()) {
      expect(program.summary, program.name).not.toBe('')
      expect(program.usage, program.name).toContain(program.name)
      expect(help).toMatch(new RegExp(`^${program.name} +${program.summary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'))
      expect(t.host.fs.tryStat(program.path, { uid: 0, gid: 0, groups: [0] })?.program).toBe(program.name)
    }
  })

  it('covers the command list in the build brief', async () => {
    const { programs } = await import('./index.ts')
    const { BUILTINS } = await import('../exec.ts')
    const brief = [
      'ls', 'cd', 'pwd', 'cat', 'more', 'head', 'tail', 'grep', 'sort', 'uniq', 'wc', 'diff',
      'who', 'whoami', 'finger', 'last', 'date', 'ps', 'chmod', 'cp', 'mv', 'rm', 'echo', 'man',
      'history', 'clear',
    ]
    for (const name of brief) {
      expect(programs.has(name) || BUILTINS.has(name), name).toBe(true)
    }
  })
})

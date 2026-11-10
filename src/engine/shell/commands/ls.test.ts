import { beforeEach, describe, expect, it } from 'vitest'
import { parseTime } from '../../world/time.ts'
import { fixture, type Fixture } from '../testing.ts'

let t: Fixture

beforeEach(() => {
  t = fixture()
  const at = (text: string): number => parseTime(text)
  const own = { uid: 101, gid: 10 }
  t.host.fs.install('/home/alice/notes', { content: 'hello\n', ...own, mtime: at('1986-09-08 17:30') })
  t.host.fs.install('/home/alice/report', { content: 'x'.repeat(2000), ...own, mode: 0o600, mtime: at('1986-09-01 09:00') })
  t.host.fs.install('/home/alice/.plan', { content: 'busy\n', ...own, mtime: at('1985-01-15 10:00') })
  t.host.fs.installDir('/home/alice/work', { ...own, mtime: at('1986-09-09 03:02') })
  t.host.fs.install('/home/alice/work/todo', { content: 't\n', ...own, mtime: at('1986-09-09 03:02') })
})

describe('ls', () => {
  it('lists the working directory, sorted, without hidden files', () => {
    expect(t.run('ls | cat').stdout).toBe('notes\nreport\nwork\n')
  })

  it('prints columns on the screen and one name per line into a pipe', () => {
    expect(t.run('ls').stdout).toBe('notes   report  work\n')
    expect(t.run('ls | cat').stdout).toBe('notes\nreport\nwork\n')
    expect(t.run('ls -1').stdout).toBe('notes\nreport\nwork\n')
  })

  it('fills columns top to bottom when there are many names', () => {
    for (let i = 10; i < 40; i++) t.host.fs.install(`/tmp/many/file-number-${i}`)
    const lines = t.run('ls /tmp/many').stdout.trimEnd().split('\n')
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.every((l) => l.length <= 80)).toBe(true)
    expect(lines[0]!.startsWith('file-number-10')).toBe(true)
    expect(lines[1]!.startsWith('file-number-11')).toBe(true)
  })

  it('shows hidden files, "." and ".." with -a', () => {
    expect(t.run('ls -a | cat').stdout).toBe('.\n..\n.plan\nnotes\nreport\nwork\n')
  })

  it('lists a named directory', () => {
    expect(t.run('ls work').stdout).toBe('todo\n')
    expect(t.run('ls /home | cat').stdout).toBe('alice\nbob\ncarol\n')
  })

  it('lists a named file as itself', () => {
    expect(t.run('ls notes').stdout).toBe('notes\n')
    expect(t.run('ls /etc/passwd').stdout).toBe('/etc/passwd\n')
  })

  it('prints nothing for an empty directory', () => {
    expect(t.run('ls /tmp')).toMatchObject({ stdout: '', status: 0 })
  })

  it('reports a missing file and still lists the rest', () => {
    const result = t.run('ls missing notes')
    expect(result.stderr).toBe('ls: missing: No such file or directory\n')
    expect(result.stdout).toBe('notes\n')
    expect(result.status).toBe(1)
  })

  it('labels each directory when given several', () => {
    expect(t.run('ls work /home/bob notes | cat').stdout).toBe('notes\n\nwork:\ntodo\n\n/home/bob:\n')
  })

  it('expands wildcards before ls sees them', () => {
    expect(t.run('ls -d * | cat').stdout).toBe('notes\nreport\nwork\n')
  })
})

describe('ls -l', () => {
  it('shows mode, owner, group, size, time and name', () => {
    expect(t.run('ls -l').stdout).toBe(
      [
        'total 4',
        '-rw-r--r--  1 alice    staff          6 Sep  8 17:30 notes',
        '-rw-------  1 alice    staff       2000 Sep  1 09:00 report',
        'drwxr-xr-x  2 alice    staff        512 Sep  9 03:02 work',
        '',
      ].join('\n'),
    )
  })

  it('shows the year instead of the time for old files', () => {
    expect(t.run('ls -la').stdout).toContain(
      '-rw-r--r--  1 alice    staff          5 Jan 15  1985 .plan\n',
    )
  })

  it('shows the setuid bit as "s"', () => {
    t.host.fs.install('/usr/local/bin/helper', {
      content: 'mv $1 $2\n',
      mode: 0o4755,
      uid: 0,
      gid: 0,
      mtime: parseTime('1985-08-12 14:00'),
    })
    expect(t.run('ls -l /usr/local/bin/helper').stdout).toBe(
      '-rwsr-xr-x  1 root     wheel          9 Aug 12  1985 /usr/local/bin/helper\n',
    )
  })

  it('shows compiled programs with their reported size', () => {
    expect(t.run('ls -l /bin/ls').stdout).toMatch(
      /^-rwxr-xr-x {2}1 root {5}wheel {3,}\d+ Mar {2}1 {2}1985 \/bin\/ls\n$/,
    )
  })

  it('shows a directory itself with -d', () => {
    expect(t.run('ls -ld /tmp').stdout).toMatch(/^drwxrwxrwt {2}2 root {5}wheel .* \/tmp\n$/)
    expect(t.run('ls -ld work').stdout).toMatch(/^drwxr-xr-x .* work\n$/)
  })

  it('shows numbers for owners that have no account', () => {
    t.host.fs.install('/tmp/orphan', { uid: 555, gid: 444 })
    expect(t.run('ls -l /tmp/orphan').stdout).toMatch(/ 555 {6}444 /)
  })

  it('accepts combined and separate flags alike', () => {
    expect(t.run('ls -l -a').stdout).toBe(t.run('ls -la').stdout)
    expect(t.run('ls -al').stdout).toBe(t.run('ls -la').stdout)
  })
})

describe('ls sorting', () => {
  it('sorts newest first with -t', () => {
    expect(t.run('ls -t | cat').stdout).toBe('work\nnotes\nreport\n')
  })

  it('reverses with -r', () => {
    expect(t.run('ls -r | cat').stdout).toBe('work\nreport\nnotes\n')
    expect(t.run('ls -tr | cat').stdout).toBe('report\nnotes\nwork\n')
  })
})

describe('ls and permissions', () => {
  beforeEach(() => {
    t.host.fs.installDir('/vault', { uid: 102, gid: 10, mode: 0o700 })
    t.host.fs.install('/vault/secret', { uid: 102, gid: 10 })
  })

  it('refuses a directory the user may not read', () => {
    const result = t.run('ls /vault')
    expect(result.stderr).toBe('ls: /vault: Permission denied\n')
    expect(result.status).toBe(1)
  })

  it('can still describe the directory itself', () => {
    expect(t.run('ls -ld /vault').stdout).toMatch(/^drwx------ {2}2 bob {6}staff /)
  })

  it('lists for the owner and for root', () => {
    expect(t.login('bob').run('ls /vault').stdout).toBe('secret\n')
    expect(t.login('root').run('ls /vault').stdout).toBe('secret\n')
  })

  it('shows names but no details when the directory is readable but not searchable', () => {
    t.host.fs.chmod('/vault', 0o744, { uid: 102, gid: 10, groups: [10] })
    expect(t.login('carol').run('ls /vault').stdout).toBe('secret\n')
    expect(t.login('carol').run('ls -l /vault').stdout).toContain('? secret\n')
  })

  it('rejects unknown options', () => {
    const result = t.run('ls -z')
    expect(result.stderr).toBe('ls: unknown option -z\nusage: ls [-ladtr] [file ...]\n')
    expect(result.status).toBe(2)
  })
})

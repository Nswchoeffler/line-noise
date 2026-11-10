import { beforeEach, describe, expect, it } from 'vitest'
import { fixture, type Fixture } from '../testing.ts'
import { grepPattern } from './grep.ts'

let t: Fixture

const LOG = [
  'alice ttyh1 08:02 1200',
  'bob ttyh2 08:15 300',
  'Alice ttyh1 13:40 60',
  'carol ttyp0 02:14 2220',
  'bob ttyh2 16:00 45',
  '',
].join('\n')

beforeEach(() => {
  t = fixture()
  t.host.fs.install('/home/alice/log', { content: LOG, uid: 101, gid: 10 })
  t.host.fs.install('/home/alice/other', { content: 'bob was here\nnothing\n', uid: 101, gid: 10 })
  t.host.fs.install('/home/bob/diary', { content: 'bob\n', uid: 102, gid: 10, mode: 0o600 })
})

describe('grep', () => {
  it('prints the lines that contain the pattern', () => {
    expect(t.run('grep bob log').stdout).toBe('bob ttyh2 08:15 300\nbob ttyh2 16:00 45\n')
  })

  it('is case sensitive unless told otherwise', () => {
    expect(t.run('grep alice log').stdout).toBe('alice ttyh1 08:02 1200\n')
    expect(t.run('grep -i alice log').stdout).toBe(
      'alice ttyh1 08:02 1200\nAlice ttyh1 13:40 60\n',
    )
  })

  it('prints the lines that do not match with -v', () => {
    expect(t.run('grep -v bob log').stdout).toBe(
      'alice ttyh1 08:02 1200\nAlice ttyh1 13:40 60\ncarol ttyp0 02:14 2220\n',
    )
  })

  it('counts matching lines with -c', () => {
    expect(t.run('grep -c bob log').stdout).toBe('2\n')
    expect(t.run('grep -c nobody log').stdout).toBe('0\n')
    expect(t.run('grep -vc bob log').stdout).toBe('3\n')
  })

  it('numbers lines with -n', () => {
    expect(t.run('grep -n bob log').stdout).toBe('2:bob ttyh2 08:15 300\n5:bob ttyh2 16:00 45\n')
  })

  it('combines flags, together or apart', () => {
    expect(t.run('grep -in alice log').stdout).toBe(
      '1:alice ttyh1 08:02 1200\n3:Alice ttyh1 13:40 60\n',
    )
    expect(t.run('grep -i -n alice log').stdout).toBe(t.run('grep -in alice log').stdout)
  })

  it('filters piped input', () => {
    expect(t.run('cat log | grep carol').stdout).toBe('carol ttyp0 02:14 2220\n')
    expect(t.run('cat log | grep ttyh | grep -c bob').stdout).toBe('2\n')
  })

  it('prefixes the file name when searching several files', () => {
    expect(t.run('grep bob log other').stdout).toBe(
      'log:bob ttyh2 08:15 300\nlog:bob ttyh2 16:00 45\nother:bob was here\n',
    )
    expect(t.run('grep -c bob log other').stdout).toBe('log:2\nother:1\n')
    expect(t.run('grep -n here log other').stdout).toBe('other:1:bob was here\n')
  })

  it('works with wildcards for the file list', () => {
    expect(t.run('grep -c bob *').stdout).toBe('log:2\nother:1\n')
  })

  it('takes a quoted pattern with spaces', () => {
    expect(t.run("grep 'ttyh2 16' log").stdout).toBe('bob ttyh2 16:00 45\n')
  })

  it('exits 0 on a match, 1 on none, 2 on trouble', () => {
    expect(t.run('grep bob log').status).toBe(0)
    expect(t.run('grep nobody log')).toMatchObject({ stdout: '', stderr: '', status: 1 })
    expect(t.run('grep bob missing').status).toBe(2)
  })

  it('reports files it cannot read and still searches the rest', () => {
    const result = t.run('grep bob /home/bob/diary log')
    expect(result.stderr).toBe('grep: /home/bob/diary: Permission denied\n')
    expect(result.stdout).toBe('bob ttyh2 08:15 300\nbob ttyh2 16:00 45\n')
    expect(t.login('root').run('grep -c bob /home/bob/diary').stdout).toBe('1\n')
  })

  it('needs a pattern, and something to search', () => {
    expect(t.run('grep').stderr).toBe(
      'grep: needs a pattern to search for\nusage: grep [-ivcn] pattern [file ...]\n',
    )
    expect(t.run('grep bob').stderr).toContain('nothing to read')
  })

  it('rejects unknown options', () => {
    expect(t.run('grep -z bob log').stderr).toContain('unknown option -z')
  })
})

describe('grep patterns', () => {
  it('anchors with ^ and $', () => {
    expect(t.run("grep '^bob' log other").stdout).toBe(
      'log:bob ttyh2 08:15 300\nlog:bob ttyh2 16:00 45\nother:bob was here\n',
    )
    expect(t.run("grep '60$' log").stdout).toBe('Alice ttyh1 13:40 60\n')
    expect(t.run("grep '^nothing$' other").stdout).toBe('nothing\n')
  })

  it('matches any character with a dot and repeats with a star', () => {
    expect(t.run("grep 'tty.0' log").stdout).toBe('carol ttyp0 02:14 2220\n')
    expect(t.run("grep 'a.*2220' log").stdout).toBe('carol ttyp0 02:14 2220\n')
  })

  it('matches character sets', () => {
    expect(t.run("grep '^[ac]' log").stdout).toBe(
      'alice ttyh1 08:02 1200\ncarol ttyp0 02:14 2220\n',
    )
    expect(t.run("grep 'ttyh[^1]' log").stdout).toBe('bob ttyh2 08:15 300\nbob ttyh2 16:00 45\n')
  })

  it('treats + ? | ( ) as ordinary characters', () => {
    t.run("echo 'cost (est.) 1+1=2?' > sums")
    expect(t.run("grep '1+1' sums").status).toBe(0)
    expect(t.run("grep '(est.)' sums").status).toBe(0)
    expect(t.run("grep '2?' sums").status).toBe(0)
    expect(t.run("grep 'a|b' sums").status).toBe(1)
  })

  it('escapes a special character with a backslash', () => {
    t.run("echo 'a.b' > dots; echo 'axb' >> dots")
    expect(t.run("grep 'a\\.b' dots").stdout).toBe('a.b\n')
    expect(t.run("grep 'a.b' dots").stdout).toBe('a.b\naxb\n')
  })

  it('treats a leading star as a literal', () => {
    t.run("echo '* starred' > stars")
    expect(t.run("grep '*' stars").stdout).toBe('* starred\n')
  })

  it('reports a pattern it cannot understand', () => {
    const result = t.run("grep '[abc' log")
    expect(result.stderr).toBe('grep: bad pattern: [abc\n')
    expect(result.status).toBe(2)
  })

  it('translates patterns as documented', () => {
    expect(grepPattern('a\\|b', false).source).toBe('a|b')
    expect(grepPattern('\\(ab\\)*', false).test('abab')).toBe(true)
    expect(grepPattern('[]x]', false).test(']')).toBe(true)
    expect(grepPattern('HELLO', true).test('hello')).toBe(true)
  })
})

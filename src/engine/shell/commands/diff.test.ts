// diff and cut, alone and together for comparing two lists.

import { beforeEach, describe, expect, it } from 'vitest'
import { fixture, type Fixture } from '../testing.ts'

let t: Fixture

function file(name: string, lines: string[]): void {
  t.host.fs.install(`/home/alice/${name}`, {
    content: lines.map((l) => l + '\n').join(''),
    uid: 101,
    gid: 10,
  })
}

beforeEach(() => {
  t = fixture()
  file('base', ['alice', 'bob', 'carol', 'dave'])
  t.host.fs.install('/home/bob/diary', { content: 'x\n', uid: 102, gid: 10, mode: 0o600 })
})

describe('diff', () => {
  it('prints nothing and exits 0 when the files match', () => {
    file('same', ['alice', 'bob', 'carol', 'dave'])
    expect(t.run('diff base same')).toMatchObject({ stdout: '', stderr: '', status: 0 })
  })

  it('shows a line that is only in the first file', () => {
    file('fewer', ['alice', 'carol', 'dave'])
    const result = t.run('diff base fewer')
    expect(result.stdout).toBe('2d1\n< bob\n')
    expect(result.status).toBe(1)
  })

  it('shows a line that is only in the second file', () => {
    file('more', ['alice', 'bob', 'carol', 'dave', 'erin'])
    expect(t.run('diff base more').stdout).toBe('4a5\n> erin\n')
  })

  it('shows an added line at the top', () => {
    file('top', ['aaron', 'alice', 'bob', 'carol', 'dave'])
    expect(t.run('diff base top').stdout).toBe('0a1\n> aaron\n')
  })

  it('shows a changed line', () => {
    file('changed', ['alice', 'bob', 'CAROL', 'dave'])
    expect(t.run('diff base changed').stdout).toBe('3c3\n< carol\n---\n> CAROL\n')
  })

  it('groups neighbouring changes into one block with ranges', () => {
    file('block', ['alice', 'x', 'y', 'z', 'dave'])
    expect(t.run('diff base block').stdout).toBe('2,3c2,4\n< bob\n< carol\n---\n> x\n> y\n> z\n')
  })

  it('reports several separate differences', () => {
    file('several', ['bob', 'carol', 'dave', 'erin', 'frank'])
    expect(t.run('diff base several').stdout).toBe('1d0\n< alice\n4a4,5\n> erin\n> frank\n')
  })

  it('handles an empty file on either side', () => {
    file('empty', [])
    expect(t.run('diff empty base').stdout).toBe('0a1,4\n> alice\n> bob\n> carol\n> dave\n')
    expect(t.run('diff base empty').stdout).toBe('1,4d0\n< alice\n< bob\n< carol\n< dave\n')
  })

  it('compares piped input when one file is "-"', () => {
    expect(t.run('grep -v bob base | diff base -').stdout).toBe('2d1\n< bob\n')
  })

  it('finds the account that is in one list and not the other', () => {
    file('used', ['alice', 'bob', 'mallory', 'carol'])
    file('billed', ['carol', 'alice', 'bob'])
    t.run('sort used > /tmp/used; sort billed > /tmp/billed')
    expect(t.run('diff /tmp/used /tmp/billed').stdout).toBe('4d3\n< mallory\n')
  })

  it('exits 2 and explains when a file is missing or unreadable', () => {
    const missing = t.run('diff base missing')
    expect(missing.stderr).toBe('diff: missing: No such file or directory\n')
    expect(missing.status).toBe(2)
    expect(t.run('diff base /home/bob/diary').stderr).toBe(
      'diff: /home/bob/diary: Permission denied\n',
    )
  })

  it('needs exactly two files', () => {
    const result = t.run('diff base')
    expect(result.stderr).toBe('diff: needs exactly two files to compare\nusage: diff file1 file2\n')
    expect(result.status).toBe(2)
  })
})

describe('cut', () => {
  beforeEach(() => {
    file('log', ['alice ttyh1 08:02 1200', 'bob ttyh2 08:15 300', 'carol ttyp0 02:14 2220'])
    file('passwd', ['alice:x:101:10:Alice Example:/home/alice', 'bob:x:102:10:Bob Example:/home/bob'])
  })

  it('picks one field', () => {
    expect(t.run("cut -d' ' -f1 log").stdout).toBe('alice\nbob\ncarol\n')
    expect(t.run('cut -d: -f5 passwd').stdout).toBe('Alice Example\nBob Example\n')
  })

  it('accepts the separator attached or as its own argument', () => {
    expect(t.run("cut -d ' ' -f 4 log").stdout).toBe('1200\n300\n2220\n')
    expect(t.run('cut -d : -f 1 passwd').stdout).toBe('alice\nbob\n')
  })

  it('picks several fields and ranges, keeping the separator', () => {
    expect(t.run("cut -d' ' -f1,4 log").stdout).toBe('alice 1200\nbob 300\ncarol 2220\n')
    expect(t.run('cut -d: -f1-3 passwd').stdout).toBe('alice:x:101\nbob:x:102\n')
    expect(t.run('cut -d: -f5- passwd').stdout).toBe(
      'Alice Example:/home/alice\nBob Example:/home/bob\n',
    )
    expect(t.run('cut -d: -f-2 passwd').stdout).toBe('alice:x\nbob:x\n')
  })

  it('never reorders fields', () => {
    expect(t.run("cut -d' ' -f4,1 log").stdout).toBe('alice 1200\nbob 300\ncarol 2220\n')
  })

  it('uses a tab as the separator by default', () => {
    t.host.fs.install('/home/alice/tabs', { content: 'a\tb\tc\n', uid: 101, gid: 10 })
    expect(t.run('cut -f2 tabs').stdout).toBe('b\n')
  })

  it('passes a line with no separator through whole', () => {
    expect(t.run('cut -d, -f2 log').stdout).toBe(
      'alice ttyh1 08:02 1200\nbob ttyh2 08:15 300\ncarol ttyp0 02:14 2220\n',
    )
  })

  it('picks character columns with -c', () => {
    expect(t.run('cut -c1-3 log').stdout).toBe('ali\nbob\ncar\n')
    expect(t.run('cut -c1,3 log').stdout).toBe('ai\nbb\ncr\n')
  })

  it('feeds the counting pipeline', () => {
    file('usage', ['bob a', 'alice b', 'bob c', 'bob d'])
    expect(t.run("cut -d' ' -f1 usage | sort | uniq -c").stdout).toBe('   1 alice\n   3 bob\n')
    expect(t.run("cat usage | cut -d' ' -f1 | sort -u").stdout).toBe('alice\nbob\n')
  })

  it('reports errors', () => {
    expect(t.run('cut log').stderr).toContain('needs either -f (fields) or -c')
    expect(t.run('cut -f1 -c1 log').stderr).toContain('needs either -f')
    expect(t.run('cut -f x log').stderr).toContain('"x" is not a list of positions')
    expect(t.run('cut -f 0 log').stderr).toContain('is not a list of positions')
    expect(t.run('cut -d:: -f1 log').stderr).toContain('must be one character')
    expect(t.run('cut -f1 missing').stderr).toBe('cut: missing: No such file or directory\n')
    expect(t.run('cut -f1 /home/bob/diary').stderr).toBe('cut: /home/bob/diary: Permission denied\n')
    expect(t.run('cut -f1').stderr).toContain('nothing to read')
  })
})

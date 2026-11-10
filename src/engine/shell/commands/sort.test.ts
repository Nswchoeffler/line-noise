// sort and uniq, alone and as the classic counting pipeline.

import { beforeEach, describe, expect, it } from 'vitest'
import { fixture, type Fixture } from '../testing.ts'

let t: Fixture

beforeEach(() => {
  t = fixture()
  const own = { uid: 101, gid: 10 }
  t.host.fs.install('/home/alice/names', { content: 'carol\nalice\nbob\nalice\ncarol\nalice\n', ...own })
  t.host.fs.install('/home/alice/numbers', { content: '10\n9\n100\n-5\n9\n', ...own })
  t.host.fs.install('/home/alice/mixed', { content: 'banana\nApple\n42\ncherry\n', ...own })
  t.host.fs.install('/home/bob/diary', { content: 'x\n', uid: 102, gid: 10, mode: 0o600 })
})

describe('sort', () => {
  it('sorts lines alphabetically', () => {
    expect(t.run('sort names').stdout).toBe('alice\nalice\nalice\nbob\ncarol\ncarol\n')
  })

  it('puts digits before capitals before lower case', () => {
    expect(t.run('sort mixed').stdout).toBe('42\nApple\nbanana\ncherry\n')
  })

  it('sorts numbers as text unless told otherwise', () => {
    expect(t.run('sort numbers').stdout).toBe('-5\n10\n100\n9\n9\n')
    expect(t.run('sort -n numbers').stdout).toBe('-5\n9\n9\n10\n100\n')
  })

  it('reverses with -r', () => {
    expect(t.run('sort -r names').stdout).toBe('carol\ncarol\nbob\nalice\nalice\nalice\n')
    expect(t.run('sort -nr numbers').stdout).toBe('100\n10\n9\n9\n-5\n')
    expect(t.run('sort -n -r numbers').stdout).toBe(t.run('sort -rn numbers').stdout)
  })

  it('drops duplicates with -u', () => {
    expect(t.run('sort -u names').stdout).toBe('alice\nbob\ncarol\n')
  })

  it('sorts by a leading number, ignoring the blanks in front of it', () => {
    t.run("echo '   3 bob' > counts; echo '  12 alice' >> counts; echo '   1 carol' >> counts")
    expect(t.run('sort -n counts').stdout).toBe('   1 carol\n   3 bob\n  12 alice\n')
    expect(t.run('sort -rn counts').stdout).toBe('  12 alice\n   3 bob\n   1 carol\n')
  })

  it('treats lines with no number as zero under -n', () => {
    expect(t.run('sort -n mixed').stdout).toBe('Apple\nbanana\ncherry\n42\n')
  })

  it('sorts piped input', () => {
    expect(t.run('cat names | sort | head -1').stdout).toBe('alice\n')
  })

  it('merges several files', () => {
    expect(t.run('sort -u names mixed').stdout).toBe('42\nApple\nalice\nbanana\nbob\ncarol\ncherry\n')
  })

  it('writes to a file through a redirect', () => {
    t.run('sort -u names > sorted')
    expect(t.run('cat sorted').stdout).toBe('alice\nbob\ncarol\n')
  })

  it('reports errors', () => {
    expect(t.run('sort missing').stderr).toBe('sort: missing: No such file or directory\n')
    expect(t.run('sort /home/bob/diary').stderr).toBe('sort: /home/bob/diary: Permission denied\n')
    expect(t.run('sort -z names').stderr).toBe(
      'sort: unknown option -z\nusage: sort [-nru] [file ...]\n',
    )
    expect(t.run('sort').stderr).toContain('nothing to read')
  })
})

describe('uniq', () => {
  it('collapses repeated neighbours only', () => {
    expect(t.run('uniq names').stdout).toBe('carol\nalice\nbob\nalice\ncarol\nalice\n')
    t.run("echo a > rep; echo a >> rep; echo b >> rep; echo a >> rep")
    expect(t.run('uniq rep').stdout).toBe('a\nb\na\n')
  })

  it('collapses every duplicate once the input is sorted', () => {
    expect(t.run('sort names | uniq').stdout).toBe('alice\nbob\ncarol\n')
  })

  it('counts with -c', () => {
    expect(t.run('sort names | uniq -c').stdout).toBe('   3 alice\n   1 bob\n   2 carol\n')
  })

  it('shows only repeated lines with -d and only single lines with -u', () => {
    expect(t.run('sort names | uniq -d').stdout).toBe('alice\ncarol\n')
    expect(t.run('sort names | uniq -u').stdout).toBe('bob\n')
  })

  it('ranks by count in the classic pipeline', () => {
    expect(t.run('sort names | uniq -c | sort -rn').stdout).toBe(
      '   3 alice\n   2 carol\n   1 bob\n',
    )
    expect(t.run('sort names | uniq -c | sort -rn | head -1').stdout).toBe('   3 alice\n')
  })

  it('reads a named file', () => {
    t.run('sort names > sorted')
    expect(t.run('uniq -c sorted').stdout).toBe('   3 alice\n   1 bob\n   2 carol\n')
  })

  it('reports errors', () => {
    expect(t.run('uniq missing').stderr).toBe('uniq: missing: No such file or directory\n')
    expect(t.run('uniq a b').stderr).toContain('takes one file at most')
    expect(t.run('uniq -z').status).toBe(2)
    expect(t.run('uniq').stderr).toContain('nothing to read')
  })
})

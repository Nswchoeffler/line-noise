// more, head, tail and wc: reading and measuring text.

import { beforeEach, describe, expect, it } from 'vitest'
import { fixture, type Fixture } from '../testing.ts'

let t: Fixture

const numbered = (from: number, to: number): string =>
  Array.from({ length: to - from + 1 }, (_, i) => `line ${from + i}\n`).join('')

beforeEach(() => {
  t = fixture()
  t.host.fs.install('/home/alice/long', { content: numbered(1, 25), uid: 101, gid: 10 })
  t.host.fs.install('/home/alice/short', { content: 'only one\n', uid: 101, gid: 10 })
  t.host.fs.install('/home/bob/diary', { content: 'private\n', uid: 102, gid: 10, mode: 0o600 })
})

describe('more', () => {
  it('prints the file and asks the terminal to page it', () => {
    const result = t.run('more long')
    expect(result.stdout).toBe(numbered(1, 25))
    expect(result.record.page).toBe(true)
  })

  it('acts like cat in a pipe, with no paging', () => {
    const result = t.run('more long | cat')
    expect(result.stdout).toBe(numbered(1, 25))
    expect(result.record.page).toBe(false)
  })

  it('pages piped input', () => {
    const result = t.run('cat long | more')
    expect(result.stdout).toBe(numbered(1, 25))
    expect(result.record.page).toBe(true)
  })

  it('puts a banner before each of several files', () => {
    expect(t.run('more short short').stdout).toBe(
      '::::::::::::::\nshort\n::::::::::::::\nonly one\n'.repeat(2),
    )
  })

  it('reports files it cannot read', () => {
    expect(t.run('more /home/bob/diary').stderr).toBe('more: /home/bob/diary: Permission denied\n')
    expect(t.run('more missing').stderr).toBe('more: missing: No such file or directory\n')
  })

  it('explains when given nothing to read', () => {
    expect(t.run('more').stderr).toContain('nothing to read')
  })
})

describe('head', () => {
  it('prints the first ten lines by default', () => {
    expect(t.run('head long').stdout).toBe(numbered(1, 10))
  })

  it.each(['head -n 3 long', 'head -n3 long', 'head -3 long'])('%s prints three lines', (line) => {
    expect(t.run(line).stdout).toBe(numbered(1, 3))
  })

  it('prints the whole file when it is shorter than the count', () => {
    expect(t.run('head short').stdout).toBe('only one\n')
  })

  it('reads from a pipe', () => {
    expect(t.run('cat long | head -2').stdout).toBe(numbered(1, 2))
  })

  it('labels several files', () => {
    expect(t.run('head -1 long short').stdout).toBe(
      '==> long <==\nline 1\n\n==> short <==\nonly one\n',
    )
  })

  it('prints nothing for a count of zero', () => {
    expect(t.run('head -n 0 long').stdout).toBe('')
  })

  it('reports errors', () => {
    expect(t.run('head missing').stderr).toBe('head: missing: No such file or directory\n')
    expect(t.run('head /home/bob/diary').stderr).toBe('head: /home/bob/diary: Permission denied\n')
    expect(t.run('head -n x long').stderr).toContain('"x" is not a number')
    expect(t.run('head -q long').stderr).toBe(
      'head: unknown option -q\nusage: head [-n count] [file ...]\n',
    )
  })
})

describe('tail', () => {
  it('prints the last ten lines by default', () => {
    expect(t.run('tail long').stdout).toBe(numbered(16, 25))
  })

  it.each(['tail -n 3 long', 'tail -n3 long', 'tail -3 long'])('%s prints three lines', (line) => {
    expect(t.run(line).stdout).toBe(numbered(23, 25))
  })

  it('starts at a given line with +N', () => {
    expect(t.run('tail +24 long').stdout).toBe(numbered(24, 25))
    expect(t.run('tail +1 short').stdout).toBe('only one\n')
  })

  it('reads from a pipe', () => {
    expect(t.run('cat long | tail -1').stdout).toBe('line 25\n')
  })

  it('combines with head to pick a middle line', () => {
    expect(t.run('head -5 long | tail -1').stdout).toBe('line 5\n')
  })

  it('prints nothing for a count of zero', () => {
    expect(t.run('tail -n 0 long').stdout).toBe('')
  })

  it('reports errors', () => {
    expect(t.run('tail missing').stderr).toBe('tail: missing: No such file or directory\n')
    expect(t.run('tail /home/bob/diary').status).toBe(1)
  })
})

describe('wc', () => {
  beforeEach(() => {
    t.host.fs.install('/home/alice/text', {
      content: 'one two three\nfour  five\n\n',
      uid: 101,
      gid: 10,
    })
  })

  it('counts lines, words and characters', () => {
    expect(t.run('wc text').stdout).toBe('       3       5      26 text\n')
  })

  it('counts only lines with -l', () => {
    expect(t.run('wc -l text').stdout).toBe('       3 text\n')
    expect(t.run('wc -l long').stdout).toBe('      25 long\n')
  })

  it('counts only words or characters when asked', () => {
    expect(t.run('wc -w text').stdout).toBe('       5 text\n')
    expect(t.run('wc -c text').stdout).toBe('      26 text\n')
    expect(t.run('wc -lw text').stdout).toBe('       3       5 text\n')
  })

  it('prints no name when reading a pipe', () => {
    expect(t.run('cat long | wc -l').stdout).toBe('      25\n')
  })

  it('counts what other commands produce', () => {
    t.run('echo a > one; echo b > two')
    expect(t.run('ls | wc -l').stdout).toBe('       5\n')
  })

  it('adds a total for several files', () => {
    expect(t.run('wc -l long short').stdout).toBe(
      '      25 long\n       1 short\n      26 total\n',
    )
  })

  it('counts zero for an empty file', () => {
    t.run('cat /nope > empty')
    expect(t.run('wc -l empty').stdout).toBe('       0 empty\n')
  })

  it('reports errors', () => {
    expect(t.run('wc missing').stderr).toBe('wc: missing: No such file or directory\n')
    expect(t.run('wc -l /home/bob/diary').stderr).toBe('wc: /home/bob/diary: Permission denied\n')
    expect(t.run('wc -x text').status).toBe(2)
  })
})

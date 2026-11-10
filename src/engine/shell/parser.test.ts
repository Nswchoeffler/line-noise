import { describe, expect, it } from 'vitest'
import { ShellSyntaxError, type Word } from './lexer.ts'
import { parse, type Pipeline } from './parser.ts'

const text = (word: Word): string => word.map((p) => p.text).join('')

/** Compact view: each pipeline as a list of [words, redirects]. */
function show(pipelines: Pipeline[]): unknown {
  return pipelines.map((p) =>
    p.commands.map((c) => {
      const words = c.words.map(text)
      const redirects = c.redirects.map((r) => `${r.op}${text(r.target)}`)
      return redirects.length > 0 ? [words, redirects] : [words]
    }),
  )
}

describe('parse', () => {
  it('parses a simple command', () => {
    expect(show(parse('ls -l /etc'))).toEqual([[[['ls', '-l', '/etc']]]])
  })

  it('returns nothing for blank input, comments and stray separators', () => {
    expect(parse('')).toEqual([])
    expect(parse('  # nothing here')).toEqual([])
    expect(parse(';;')).toEqual([])
  })

  it('splits a pipeline into commands', () => {
    expect(show(parse('sort names | uniq -c | sort -rn'))).toEqual([
      [[['sort', 'names']], [['uniq', '-c']], [['sort', '-rn']]],
    ])
  })

  it('attaches redirects to their command, wherever they appear', () => {
    expect(show(parse('sort < in > out'))).toEqual([[[['sort'], ['<in', '>out']]]])
    expect(show(parse('> out echo hi'))).toEqual([[[['echo', 'hi'], ['>out']]]])
    expect(show(parse('echo hi >> log there'))).toEqual([[[['echo', 'hi', 'there'], ['>>log']]]])
  })

  it('keeps redirects with the right stage of a pipeline', () => {
    expect(show(parse('grep x < in | wc -l > count'))).toEqual([
      [[['grep', 'x'], ['<in']], [['wc', '-l'], ['>count']]],
    ])
  })

  it('separates pipelines at semicolons and newlines', () => {
    expect(show(parse('pwd; ls | wc\nwhoami'))).toEqual([
      [[['pwd']]],
      [[['ls']], [['wc']]],
      [[['whoami']]],
    ])
  })

  it('parses a multi-line script with comments and blank lines', () => {
    const script = '# make a copy\ncp /bin/sh /tmp/sh\n\nchmod 4755 /tmp/sh\n'
    expect(show(parse(script))).toEqual([
      [[['cp', '/bin/sh', '/tmp/sh']]],
      [[['chmod', '4755', '/tmp/sh']]],
    ])
  })

  it.each(['| ls', 'ls |', 'ls | | wc', 'ls ; | wc', '> out'])(
    'rejects an empty command in %j',
    (line) => {
      expect(() => parse(line)).toThrow('Invalid null command.')
    },
  )

  it.each(['ls >', 'ls > | wc', 'sort < ; ls', 'echo >> >'])(
    'rejects a redirect with no file in %j',
    (line) => {
      expect(() => parse(line)).toThrow('Missing name for redirect.')
    },
  )

  it('passes lexer errors through', () => {
    expect(() => parse("echo 'oops")).toThrow(ShellSyntaxError)
  })
})

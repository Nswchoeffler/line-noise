import { describe, expect, it } from 'vitest'
import { ShellSyntaxError, tokenize, type Token } from './lexer.ts'

/** Compact view of tokens: words as their parts, operators as `op:x`. */
function show(tokens: Token[]): unknown[] {
  return tokens.map((t) =>
    t.type === 'op' ? `op:${t.op}` : t.word.map((p) => (p.quote === 'none' ? p.text : [p.quote, p.text])),
  )
}

describe('tokenize: words', () => {
  it('splits on spaces and tabs', () => {
    expect(show(tokenize('ls  -l\t/etc'))).toEqual([['ls'], ['-l'], ['/etc']])
  })

  it('returns nothing for a blank line', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize('   \t ')).toEqual([])
  })

  it('keeps single-quoted text exactly, including spaces and specials', () => {
    expect(show(tokenize("grep 'a b | $x > *'"))).toEqual([['grep'], [['single', 'a b | $x > *']]])
  })

  it('keeps double-quoted text as one part', () => {
    expect(show(tokenize('echo "two words"'))).toEqual([['echo'], [['double', 'two words']]])
  })

  it('joins adjacent quoted and unquoted pieces into one word', () => {
    expect(show(tokenize(`a"b c"'d e'f`))).toEqual([
      ['a', ['double', 'b c'], ['single', 'd e'], 'f'],
    ])
  })

  it('keeps an empty quoted string as a word', () => {
    expect(show(tokenize("echo '' x"))).toEqual([['echo'], [['single', '']], ['x']])
    expect(show(tokenize('echo ""'))).toEqual([['echo'], [['double', '']]])
  })

  it('treats a backslash as quoting the next character', () => {
    expect(show(tokenize('echo a\\ b \\$HOME'))).toEqual([
      ['echo'],
      ['a', ['single', ' '], 'b'],
      [['single', '$'], 'HOME'],
    ])
  })

  it('handles escapes inside double quotes', () => {
    expect(show(tokenize('echo "say \\"hi\\" \\$5 a\\b"'))).toEqual([
      ['echo'],
      [
        ['double', 'say '],
        ['single', '"'],
        ['double', 'hi'],
        ['single', '"'],
        ['double', ' '],
        ['single', '$'],
        ['double', '5 a\\b'],
      ],
    ])
  })

  it('reports unbalanced quotes', () => {
    expect(() => tokenize("echo 'oops")).toThrow("Unmatched '.")
    expect(() => tokenize('echo "oops')).toThrow('Unmatched ".')
    expect(() => tokenize('echo oops\\')).toThrow(ShellSyntaxError)
  })
})

describe('tokenize: operators', () => {
  it('recognizes pipes, redirects and separators without surrounding spaces', () => {
    expect(show(tokenize('sort<in|uniq -c>out;wc>>log'))).toEqual([
      ['sort'],
      'op:<',
      ['in'],
      'op:|',
      ['uniq'],
      ['-c'],
      'op:>',
      ['out'],
      'op:;',
      ['wc'],
      'op:>>',
      ['log'],
    ])
  })

  it('treats a newline as a command separator', () => {
    expect(show(tokenize('pwd\nwhoami'))).toEqual([['pwd'], 'op:;', ['whoami']])
  })

  it('does not treat quoted operators as operators', () => {
    expect(show(tokenize('echo "a|b" \'c>d\' e\\;f'))).toEqual([
      ['echo'],
      [['double', 'a|b']],
      [['single', 'c>d']],
      ['e', ['single', ';'], 'f'],
    ])
  })
})

describe('tokenize: comments', () => {
  it('ignores a comment at the start of a word', () => {
    expect(show(tokenize('ls # list files'))).toEqual([['ls']])
    expect(show(tokenize('# only a comment'))).toEqual([])
  })

  it('ends a comment at the newline', () => {
    expect(show(tokenize('# first\nls'))).toEqual(['op:;', ['ls']])
  })

  it('keeps a hash inside a word', () => {
    expect(show(tokenize('echo a#b'))).toEqual([['echo'], ['a#b']])
  })
})

describe('tokenize: unsupported syntax gets a clear message', () => {
  it.each([
    ['ls && pwd', '"&&"'],
    ['ls || pwd', '"||"'],
    ['sleep 5 &', 'background jobs'],
    ['echo `date`', 'backquotes'],
    ['echo $(date)', '"$(...)"'],
    ['(ls)', 'parentheses'],
    ['ls 2>errors', 'numbered streams'],
    ['ls >&2', '">&"'],
    ['cat <<EOF', '"<<"'],
  ])('%s', (line, mention) => {
    expect(() => tokenize(line)).toThrow(ShellSyntaxError)
    expect(() => tokenize(line)).toThrow(mention)
  })

  it('still allows a number as an ordinary argument before a redirect', () => {
    expect(show(tokenize('echo 2 > f'))).toEqual([['echo'], ['2'], 'op:>', ['f']])
  })
})

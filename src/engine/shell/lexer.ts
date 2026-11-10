/**
 * How a piece of a word was quoted. This decides what happens to it later:
 * unquoted text gets variable and wildcard expansion, double-quoted text gets
 * variable expansion only, and single-quoted text is taken exactly as typed.
 */
export type Quote = 'none' | 'double' | 'single'

export interface WordPart {
  text: string
  quote: Quote
}

/** One shell word, made of adjacent parts: `a"b c"'d'` is one word of three parts. */
export type Word = WordPart[]

export type Operator = '|' | '>' | '>>' | '<' | ';'

export type Token = { type: 'word'; word: Word } | { type: 'op'; op: Operator }

/** A problem with what was typed. The message is shown to the player as is. */
export class ShellSyntaxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShellSyntaxError'
  }
}

function unsupported(what: string): ShellSyntaxError {
  return new ShellSyntaxError(`This shell does not support ${what}.`)
}

const WHITESPACE = /[ \t\r]/

/** Split a command line into words and operators. */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let parts: Word = []
  let inWord = false
  let i = 0

  const push = (text: string, quote: Quote): void => {
    inWord = true
    const last = parts[parts.length - 1]
    if (last && last.quote === quote) last.text += text
    else parts.push({ text, quote })
  }

  const endWord = (): void => {
    if (inWord) tokens.push({ type: 'word', word: parts })
    parts = []
    inWord = false
  }

  const op = (value: Operator): void => {
    endWord()
    tokens.push({ type: 'op', op: value })
  }

  while (i < source.length) {
    const ch = source[i]!
    const next = source[i + 1]

    if (WHITESPACE.test(ch)) {
      endWord()
      i++
    } else if (ch === '\n') {
      op(';')
      i++
    } else if (ch === '#' && !inWord) {
      // A comment runs to the end of the line.
      while (i < source.length && source[i] !== '\n') i++
    } else if (ch === "'") {
      const end = source.indexOf("'", i + 1)
      if (end === -1) throw new ShellSyntaxError("Unmatched '.")
      push(source.slice(i + 1, end), 'single')
      i = end + 1
    } else if (ch === '"') {
      let text = ''
      i++
      for (;;) {
        if (i >= source.length) throw new ShellSyntaxError('Unmatched ".')
        const c = source[i]!
        if (c === '"') break
        if (c === '\\' && i + 1 < source.length && '"\\$'.includes(source[i + 1]!)) {
          // An escaped character inside double quotes is literal, so it must
          // not be seen by variable expansion: emit it as its own quoted part.
          if (text !== '') push(text, 'double')
          text = ''
          push(source[i + 1]!, 'single')
          i += 2
        } else {
          text += c
          i++
        }
      }
      push(text, 'double')
      i++
    } else if (ch === '\\') {
      if (next === undefined) throw new ShellSyntaxError('Nothing after the final backslash.')
      if (next !== '\n') push(next, 'single')
      i += 2
    } else if (ch === '|') {
      if (next === '|') throw unsupported('"||"')
      op('|')
      i++
    } else if (ch === '>') {
      const last = parts[parts.length - 1]
      if (inWord && parts.length === 1 && last!.quote === 'none' && /^\d+$/.test(last!.text)) {
        throw unsupported(`redirecting numbered streams ("${last!.text}>")`)
      }
      if (next === '>') {
        op('>>')
        i += 2
      } else {
        if (next === '&') throw unsupported('">&"')
        op('>')
        i++
      }
    } else if (ch === '<') {
      if (next === '<') throw unsupported('"<<"')
      op('<')
      i++
    } else if (ch === ';') {
      op(';')
      i++
    } else if (ch === '&') {
      throw unsupported(next === '&' ? '"&&"' : 'background jobs ("&")')
    } else if (ch === '`') {
      throw unsupported('backquotes')
    } else if (ch === '(' || ch === ')') {
      throw unsupported('parentheses')
    } else if (ch === '$' && next === '(') {
      throw unsupported('"$(...)"')
    } else {
      push(ch, 'none')
      i++
    }
  }
  endWord()
  return tokens
}

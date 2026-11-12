import { UsageError, type Program } from '../types.ts'
import { parseArgs, readInputs, toLines } from './util.ts'

/**
 * Translate a classic grep pattern into a JavaScript regular expression.
 * In grep's basic syntax only `.`, `*`, `^`, `$`, `[...]` and `\` are special;
 * `+ ? | ( ) { }` are ordinary characters unless written with a backslash.
 */
export function grepPattern(pattern: string, ignoreCase: boolean): RegExp {
  let source = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!
    if (ch === '\\') {
      const next = pattern[++i]
      if (next === undefined) throw new SyntaxError('trailing backslash')
      // \( \) \| \+ \? \{ \} are the operators; everything else is a literal.
      source += '(){}|+?'.includes(next) ? next : `\\${next}`
    } else if ('(){}|+?'.includes(ch)) {
      source += `\\${ch}`
    } else if (ch === '[') {
      // A bracket set. A "]" right after "[" or "[^" is a member, not the end,
      // and a backslash inside a set is just a backslash.
      let end = i + 1
      let body = ''
      const negate = pattern[end] === '^'
      if (negate) end++
      if (pattern[end] === ']') {
        body += '\\]'
        end++
      }
      for (; end < pattern.length && pattern[end] !== ']'; end++) {
        body += pattern[end] === '\\' ? '\\\\' : pattern[end]
      }
      if (end >= pattern.length) throw new SyntaxError('unmatched [')
      source += `[${negate ? '^' : ''}${body}]`
      i = end
    } else if (ch === '*' && (source === '' || source === '^')) {
      source += '\\*' // a leading star has nothing to repeat, so it is literal
    } else {
      source += ch
    }
  }
  return new RegExp(source, ignoreCase ? 'i' : '')
}

export const grep: Program = {
  name: 'grep',
  path: '/bin/grep',
  summary: 'print lines that match a pattern',
  usage: 'grep [-ivcnl] pattern [file ...]',
  run(ctx) {
    const { flags, operands } = parseArgs(ctx.args, 'ivcnl')
    const [pattern, ...files] = operands
    if (pattern === undefined) throw new UsageError('needs a pattern to search for')

    let regex: RegExp
    try {
      regex = grepPattern(pattern, flags.has('i'))
    } catch {
      return { stdout: '', stderr: `grep: bad pattern: ${pattern}\n`, status: 2 }
    }

    const { inputs, stderr } = readInputs(ctx, files)
    const labelled = inputs.length > 1
    const invert = flags.has('v')
    let stdout = ''
    let matched = false

    for (const input of inputs) {
      const prefix = labelled ? `${input.name ?? '(standard input)'}:` : ''
      let count = 0
      toLines(input.content).forEach((line, index) => {
        if (regex.test(line) === invert) return
        count++
        if (!flags.has('c') && !flags.has('l')) {
          stdout += `${prefix}${flags.has('n') ? `${index + 1}:` : ''}${line}\n`
        }
      })
      // -l names each file that has a match, once, and prints no lines.
      if (flags.has('l')) {
        if (count > 0) stdout += `${input.name ?? '(standard input)'}\n`
      } else if (flags.has('c')) stdout += `${prefix}${count}\n`
      if (count > 0) matched = true
    }

    // 0: found something. 1: found nothing. 2: something went wrong.
    return { stdout, stderr, status: stderr !== '' ? 2 : matched ? 0 : 1 }
  },
}

import type { Program } from '../types.ts'
import { parseArgs, readInputs } from './util.ts'

interface Counts {
  lines: number
  words: number
  chars: number
}

function count(text: string): Counts {
  return {
    lines: text.split('\n').length - 1,
    words: text.split(/\s+/).filter((w) => w !== '').length,
    chars: text.length,
  }
}

export const wc: Program = {
  name: 'wc',
  path: '/usr/bin/wc',
  summary: 'count lines, words and characters',
  usage: 'wc [-lwc] [file ...]',
  run(ctx) {
    const { flags, operands } = parseArgs(ctx.args, 'lwc')
    const { inputs, stderr } = readInputs(ctx, operands)
    const all = flags.size === 0

    const row = (c: Counts, name: string | undefined): string => {
      let out = ''
      if (all || flags.has('l')) out += String(c.lines).padStart(8)
      if (all || flags.has('w')) out += String(c.words).padStart(8)
      if (all || flags.has('c')) out += String(c.chars).padStart(8)
      return out + (name === undefined ? '' : ` ${name}`) + '\n'
    }

    const total: Counts = { lines: 0, words: 0, chars: 0 }
    let stdout = ''
    for (const input of inputs) {
      const c = count(input.content)
      total.lines += c.lines
      total.words += c.words
      total.chars += c.chars
      stdout += row(c, input.name)
    }
    if (inputs.length > 1) stdout += row(total, 'total')

    return { stdout, stderr, status: stderr === '' ? 0 : 1 }
  },
}

import type { Program } from '../types.ts'
import { fromLines, parseArgs, readInputs, toLines } from './util.ts'

/** Plain character-code order: digits, then capitals, then lower case. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** The number a line starts with, ignoring leading blanks. Lines with no number count as 0. */
function leadingNumber(line: string): number {
  const match = /^\s*(-?\d+(?:\.\d+)?)/.exec(line)
  return match ? Number(match[1]) : 0
}

export const sort: Program = {
  name: 'sort',
  path: '/usr/bin/sort',
  summary: 'put lines in order',
  usage: 'sort [-nru] [file ...]',
  run(ctx) {
    const { flags, operands } = parseArgs(ctx.args, 'nru')
    const { inputs, stderr } = readInputs(ctx, operands)

    let lines = inputs.flatMap((input) => toLines(input.content))
    const compare = flags.has('n')
      ? (a: string, b: string) => leadingNumber(a) - leadingNumber(b) || compareText(a, b)
      : compareText
    lines.sort(compare)
    if (flags.has('r')) lines.reverse()
    if (flags.has('u')) lines = lines.filter((line, i) => i === 0 || line !== lines[i - 1])

    return { stdout: fromLines(lines), stderr, status: stderr === '' ? 0 : 1 }
  },
}

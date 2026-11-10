import { UsageError, type Program } from '../types.ts'
import { parseArgs, readInputs, toLines } from './util.ts'

export const uniq: Program = {
  name: 'uniq',
  path: '/usr/bin/uniq',
  summary: 'collapse repeated lines that sit next to each other',
  usage: 'uniq [-cdu] [file]',
  run(ctx) {
    const { flags, operands } = parseArgs(ctx.args, 'cdu')
    if (operands.length > 1) throw new UsageError('takes one file at most')
    const { inputs, stderr } = readInputs(ctx, operands)

    // Only neighbours are compared, which is why input is usually sorted first.
    const groups: { line: string; count: number }[] = []
    for (const line of inputs.flatMap((input) => toLines(input.content))) {
      const last = groups[groups.length - 1]
      if (last && last.line === line) last.count++
      else groups.push({ line, count: 1 })
    }

    let stdout = ''
    for (const { line, count } of groups) {
      if (flags.has('d') && count === 1) continue
      if (flags.has('u') && count > 1) continue
      stdout += flags.has('c') ? `${String(count).padStart(4)} ${line}\n` : `${line}\n`
    }
    return { stdout, stderr, status: stderr === '' ? 0 : 1 }
  },
}

import { UsageError, type Program } from '../types.ts'
import { fromLines, parseArgs, readInputs, toLines } from './util.ts'

/** Parse a list such as `1`, `1,3`, `2-4`, `-3` or `2-` into a test for 1-based positions. */
function parseList(list: string): (position: number) => boolean {
  const ranges: [number, number][] = []
  for (const item of list.split(',')) {
    const match = /^(\d*)(-?)(\d*)$/.exec(item)
    if (!match || (match[1] === '' && match[3] === '')) {
      throw new UsageError(`"${list}" is not a list of positions`)
    }
    const first = match[1] === '' ? 1 : Number(match[1])
    const last = match[2] === '' ? first : match[3] === '' ? Infinity : Number(match[3])
    if (first < 1 || last < first) throw new UsageError(`"${list}" is not a list of positions`)
    ranges.push([first, last])
  }
  return (position) => ranges.some(([first, last]) => position >= first && position <= last)
}

export const cut: Program = {
  name: 'cut',
  path: '/usr/bin/cut',
  summary: 'pick columns out of each line',
  usage: "cut -d 'separator' -f fields [file ...]    or    cut -c columns [file ...]",
  run(ctx) {
    const { values, operands } = parseArgs(ctx.args, '', 'dfc')
    const fields = values.get('f')
    const columns = values.get('c')
    if ((fields === undefined) === (columns === undefined)) {
      throw new UsageError('needs either -f (fields) or -c (character columns)')
    }

    const delimiter = values.get('d') ?? '\t'
    if (delimiter.length !== 1) throw new UsageError('the separator for -d must be one character')

    const wanted = parseList((fields ?? columns)!)
    const { inputs, stderr } = readInputs(ctx, operands)

    const lines = inputs
      .flatMap((input) => toLines(input.content))
      .map((line) => {
        if (columns !== undefined) {
          return [...line].filter((_, i) => wanted(i + 1)).join('')
        }
        // A line without the separator has no fields to pick from: pass it through.
        if (!line.includes(delimiter)) return line
        return line
          .split(delimiter)
          .filter((_, i) => wanted(i + 1))
          .join(delimiter)
      })

    return { stdout: fromLines(lines), stderr, status: stderr === '' ? 0 : 1 }
  },
}

import { UsageError, type Program, type ProgramContext, type ProgramResult } from '../types.ts'
import { fromLines, parseCount, readInputs, toLines } from './util.ts'

const DEFAULT_COUNT = 10

interface Selection {
  /** Number of lines, or the starting line for `tail +N`. */
  count: number
  fromStart: boolean
  files: string[]
}

/**
 * Parse the line-count options shared by head and tail: `-n 5`, `-n5`, the
 * older `-5`, and for tail `+5` (start at line 5).
 */
function parseSelection(ctx: ProgramContext, allowPlus: boolean): Selection {
  const selection: Selection = { count: DEFAULT_COUNT, fromStart: false, files: [] }
  const args = ctx.args
  let i = 0
  for (; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--') {
      i++
      break
    }
    if (arg === '-n') {
      const value = args[++i]
      if (value === undefined) throw new UsageError('option -n needs a number')
      selection.count = parseCount(value)
    } else if (/^-n\d+$/.test(arg)) {
      selection.count = Number(arg.slice(2))
    } else if (/^-\d+$/.test(arg)) {
      selection.count = Number(arg.slice(1))
    } else if (allowPlus && /^\+\d+$/.test(arg)) {
      selection.count = Number(arg.slice(1))
      selection.fromStart = true
    } else if (arg.startsWith('-') && arg !== '-') {
      throw new UsageError(`unknown option ${arg}`)
    } else {
      break
    }
  }
  selection.files = args.slice(i)
  return selection
}

function run(
  ctx: ProgramContext,
  selection: Selection,
  pick: (lines: string[]) => string[],
): ProgramResult {
  const { inputs, stderr } = readInputs(ctx, selection.files)
  const labelled = inputs.length > 1
  const stdout = inputs
    .map((input, index) => {
      const body = fromLines(pick(toLines(input.content)))
      if (!labelled) return body
      return `${index > 0 ? '\n' : ''}==> ${input.name ?? 'standard input'} <==\n${body}`
    })
    .join('')
  return { stdout, stderr, status: stderr === '' ? 0 : 1 }
}

export const head: Program = {
  name: 'head',
  path: '/usr/ucb/head',
  summary: 'print the first lines of a file',
  usage: 'head [-n count] [file ...]',
  run(ctx) {
    const selection = parseSelection(ctx, false)
    return run(ctx, selection, (lines) => lines.slice(0, selection.count))
  },
}

export const tail: Program = {
  name: 'tail',
  path: '/usr/ucb/tail',
  summary: 'print the last lines of a file',
  usage: 'tail [-n count] [file ...]',
  run(ctx) {
    const selection = parseSelection(ctx, true)
    return run(ctx, selection, (lines) => {
      if (selection.fromStart) return lines.slice(Math.max(0, selection.count - 1))
      return selection.count === 0 ? [] : lines.slice(-selection.count)
    })
  },
}

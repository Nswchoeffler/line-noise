import { UsageError, type Program } from '../types.ts'
import { parseArgs, readInputs, toLines } from './util.ts'

type Edit = { op: 'keep' | 'delete' | 'insert'; line: string }

/** The shortest list of edits that turns `a` into `b`, by longest common subsequence. */
function editScript(a: string[], b: string[]): Edit[] {
  // lcs[i][j] is the length of the longest common subsequence of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  )
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }

  const edits: Edit[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      edits.push({ op: 'keep', line: a[i]! })
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      edits.push({ op: 'delete', line: a[i++]! })
    } else {
      edits.push({ op: 'insert', line: b[j++]! })
    }
  }
  while (i < a.length) edits.push({ op: 'delete', line: a[i++]! })
  while (j < b.length) edits.push({ op: 'insert', line: b[j++]! })
  return edits
}

const range = (first: number, last: number): string =>
  first === last ? String(first) : `${first},${last}`

/**
 * Format edits the classic way: `3d2` (line 3 deleted), `2a3,4` (lines added
 * after line 2), `5c5` (line 5 changed), with `<` marking lines from the first
 * file and `>` lines from the second.
 */
function format(edits: Edit[]): string {
  let out = ''
  let aLine = 0 // lines of the first file consumed so far
  let bLine = 0
  let index = 0
  while (index < edits.length) {
    if (edits[index]!.op === 'keep') {
      aLine++
      bLine++
      index++
      continue
    }
    const deleted: string[] = []
    const inserted: string[] = []
    while (index < edits.length && edits[index]!.op !== 'keep') {
      const edit = edits[index++]!
      if (edit.op === 'delete') deleted.push(edit.line)
      else inserted.push(edit.line)
    }
    const aRange = range(aLine + 1, aLine + deleted.length)
    const bRange = range(bLine + 1, bLine + inserted.length)
    if (inserted.length === 0) out += `${aRange}d${bLine}\n`
    else if (deleted.length === 0) out += `${aLine}a${bRange}\n`
    else out += `${aRange}c${bRange}\n`
    for (const line of deleted) out += `< ${line}\n`
    if (deleted.length > 0 && inserted.length > 0) out += '---\n'
    for (const line of inserted) out += `> ${line}\n`
    aLine += deleted.length
    bLine += inserted.length
  }
  return out
}

export const diff: Program = {
  name: 'diff',
  path: '/bin/diff',
  summary: 'show the lines that differ between two files',
  usage: 'diff file1 file2',
  run(ctx) {
    const { operands } = parseArgs(ctx.args, '')
    if (operands.length !== 2) throw new UsageError('needs exactly two files to compare')

    const { inputs, stderr } = readInputs(ctx, operands)
    if (inputs.length !== 2) return { stdout: '', stderr, status: 2 }

    const stdout = format(editScript(toLines(inputs[0]!.content), toLines(inputs[1]!.content)))
    // 0: the files match. 1: they differ. 2: something went wrong.
    return { stdout, stderr: '', status: stdout === '' ? 0 : 1 }
  },
}

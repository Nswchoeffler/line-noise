import { VfsError } from '../../vfs/index.ts'
import { UsageError, type ProgramContext, type ProgramResult } from '../types.ts'

export function ok(stdout = ''): ProgramResult {
  return { stdout, stderr: '', status: 0 }
}

export function fail(ctx: ProgramContext, message: string, status = 1): ProgramResult {
  return { stdout: '', stderr: `${ctx.name}: ${message}\n`, status }
}

/** The reason part of an error message: `No such file or directory`. */
export function reason(err: unknown): string {
  if (err instanceof VfsError) return err.message
  throw err
}

/** Split text into lines. A final newline ends the last line; it does not start a new one. */
export function toLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Join lines back into text, each ending in a newline. */
export function fromLines(lines: readonly string[]): string {
  return lines.map((l) => l + '\n').join('')
}

export interface ParsedArgs {
  flags: Set<string>
  values: Map<string, string>
  operands: string[]
}

/**
 * Parse single-letter options. `flags` are on/off letters and `values` are
 * letters that take an argument (`-n 5` or `-n5`). Letters can be combined
 * (`-la`). A `--` ends the options. Unknown letters raise a UsageError.
 */
export function parseArgs(args: readonly string[], flags: string, values = ''): ParsedArgs {
  const out: ParsedArgs = { flags: new Set(), values: new Map(), operands: [] }
  let i = 0
  for (; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--') {
      i++
      break
    }
    if (!arg.startsWith('-') || arg === '-') break
    for (let j = 1; j < arg.length; j++) {
      const letter = arg[j]!
      if (flags.includes(letter)) {
        out.flags.add(letter)
      } else if (values.includes(letter)) {
        const attached = arg.slice(j + 1)
        if (attached !== '') {
          out.values.set(letter, attached)
        } else {
          const next = args[++i]
          if (next === undefined) throw new UsageError(`option -${letter} needs a value`)
          out.values.set(letter, next)
        }
        break
      } else {
        throw new UsageError(`unknown option -${letter}`)
      }
    }
  }
  out.operands = args.slice(i)
  return out
}

/** Parse a count such as the `5` in `head -n 5`. */
export function parseCount(text: string, what = 'number'): number {
  if (!/^\d+$/.test(text)) throw new UsageError(`"${text}" is not a ${what}`)
  return Number(text)
}

export interface Input {
  /** File name as typed, or undefined for piped input. */
  name: string | undefined
  content: string
}

/**
 * Gather what a filter command should read: the named files, or else
 * whatever was piped in. A real terminal would sit waiting for typed input
 * when given neither; here that gets an explanation instead.
 */
export function readInputs(
  ctx: ProgramContext,
  files: readonly string[],
): { inputs: Input[]; stderr: string } {
  if (files.length === 0) {
    if (ctx.stdinIsTTY) {
      return {
        inputs: [],
        stderr: `${ctx.name}: nothing to read. Name a file, or pipe another command into ${ctx.name}.\n`,
      }
    }
    return { inputs: [{ name: undefined, content: ctx.stdin }], stderr: '' }
  }

  const inputs: Input[] = []
  let stderr = ''
  for (const file of files) {
    if (file === '-') {
      inputs.push({ name: undefined, content: ctx.stdin })
      continue
    }
    try {
      const path = ctx.resolve(file)
      if (ctx.fs.stat(path, ctx.cred).program !== undefined) {
        stderr += `${ctx.name}: ${file}: this is a compiled program, not text\n`
        continue
      }
      inputs.push({ name: file, content: ctx.fs.readFile(path, ctx.cred) })
    } catch (err) {
      stderr += `${ctx.name}: ${file}: ${reason(err)}\n`
    }
  }
  return { inputs, stderr }
}

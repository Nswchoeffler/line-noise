import type { Program } from '../types.ts'
import { parseArgs, readInputs } from './util.ts'

export const cat: Program = {
  name: 'cat',
  path: '/bin/cat',
  summary: 'print files',
  usage: 'cat [file ...]',
  run(ctx) {
    const { operands } = parseArgs(ctx.args, '')
    const { inputs, stderr } = readInputs(ctx, operands)
    return {
      stdout: inputs.map((input) => input.content).join(''),
      stderr,
      status: stderr === '' ? 0 : 1,
    }
  },
}

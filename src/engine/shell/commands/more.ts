import type { Program } from '../types.ts'
import { parseArgs, readInputs } from './util.ts'

export const more: Program = {
  name: 'more',
  path: '/usr/ucb/more',
  summary: 'read a long file one screen at a time',
  usage: 'more [file ...]',
  run(ctx) {
    const { operands } = parseArgs(ctx.args, '')
    const { inputs, stderr } = readInputs(ctx, operands)

    // With several files, each gets a banner, as the real more did.
    const banner = inputs.length > 1
    const stdout = inputs
      .map((input) =>
        banner && input.name !== undefined
          ? `::::::::::::::\n${input.name}\n::::::::::::::\n${input.content}`
          : input.content,
      )
      .join('')

    return {
      stdout,
      stderr,
      status: stderr === '' ? 0 : 1,
      // Paging only makes sense on a screen. In a pipe, more behaves like cat.
      ...(ctx.stdoutIsTTY ? { effects: [{ type: 'page' as const }] } : {}),
    }
  },
}

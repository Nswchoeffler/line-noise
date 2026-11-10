import type { Program } from '../types.ts'
import { ok } from './util.ts'

export const echo: Program = {
  name: 'echo',
  path: '/bin/echo',
  summary: 'print its arguments',
  usage: 'echo [-n] [text ...]',
  run(ctx) {
    const noNewline = ctx.args[0] === '-n'
    const words = noNewline ? ctx.args.slice(1) : ctx.args
    return ok(words.join(' ') + (noNewline ? '' : '\n'))
  },
}

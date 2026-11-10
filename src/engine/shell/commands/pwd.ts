import type { Program } from '../types.ts'
import { ok } from './util.ts'

export const pwd: Program = {
  name: 'pwd',
  path: '/bin/pwd',
  summary: 'print the working directory',
  usage: 'pwd',
  run(ctx) {
    return ok(ctx.cwd + '\n')
  },
}

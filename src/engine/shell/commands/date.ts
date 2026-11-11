import { formatDate } from '../../world/time.ts'
import type { Program } from '../types.ts'
import { ok } from './util.ts'

export const date: Program = {
  name: 'date',
  path: '/bin/date',
  summary: 'print the date and time',
  usage: 'date',
  run(ctx) {
    return ok(formatDate(ctx.host.clock.now, ctx.host.timezone) + '\n')
  },
}

import type { Program } from '../types.ts'
import { ok } from './util.ts'

export const whoami: Program = {
  name: 'whoami',
  path: '/usr/ucb/whoami',
  summary: 'print the user you are acting as',
  usage: 'whoami',
  run(ctx) {
    // The effective user: under a setuid program this is the file's owner.
    return ok(ctx.host.users.userName(ctx.cred.uid) + '\n')
  },
}

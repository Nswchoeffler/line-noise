import type { Program } from '../types.ts'
import { fail, reason } from './util.ts'

export const sh: Program = {
  name: 'sh',
  path: '/bin/sh',
  summary: 'start a shell, or run a script',
  usage: 'sh [-c command] [script [argument ...]]',
  run(ctx) {
    const [first, ...rest] = ctx.args

    if (first === '-c') {
      if (rest[0] === undefined) return fail(ctx, 'option -c needs a command', 2)
      return ctx.runScript(rest[0], rest.slice(1), ctx.stdin)
    }

    if (first === undefined) {
      // Nothing piped in: become an interactive shell. The credentials are
      // whatever this copy of sh is running with, which is the whole point of
      // a setuid shell.
      if (ctx.stdinIsTTY) {
        return { stdout: '', stderr: '', status: 0, effects: [{ type: 'shell', cred: ctx.cred }] }
      }
      return ctx.runScript(ctx.stdin, [], '')
    }

    let source: string
    try {
      source = ctx.fs.readFile(ctx.resolve(first), ctx.cred)
    } catch (err) {
      return fail(ctx, `${first}: ${reason(err)}`, 127)
    }
    return ctx.runScript(source, rest, ctx.stdin)
  },
}

import { VfsError } from '../../vfs/index.ts'
import { UsageError, type Program, type ProgramContext } from '../types.ts'
import { parseArgs, reason } from './util.ts'

/** Remove a directory and everything in it. Throws on the first thing that cannot go. */
function removeTree(ctx: ProgramContext, path: string): void {
  for (const name of ctx.fs.readdir(path, ctx.cred)) {
    const child = `${path}/${name}`
    if (ctx.fs.stat(child, ctx.cred).kind === 'dir') removeTree(ctx, child)
    else ctx.fs.unlink(child, ctx.cred)
  }
  ctx.fs.rmdir(path, ctx.cred)
}

export const rm: Program = {
  name: 'rm',
  path: '/bin/rm',
  summary: 'remove files',
  usage: 'rm [-rf] file ...',
  run(ctx) {
    const { flags, operands } = parseArgs(ctx.args, 'rfi')
    const force = flags.has('f')
    if (operands.length === 0) {
      if (force) return { stdout: '', stderr: '', status: 0 }
      throw new UsageError('needs the name of a file to remove')
    }

    let stderr = ''
    for (const target of operands) {
      const path = ctx.resolve(target)
      try {
        if (ctx.fs.stat(path, ctx.cred).kind === 'dir') {
          if (!flags.has('r')) {
            stderr += `rm: ${target}: Is a directory\n`
            continue
          }
          removeTree(ctx, path)
        } else {
          ctx.fs.unlink(path, ctx.cred)
        }
      } catch (err) {
        // With -f, a file that is already gone is not worth mentioning.
        if (force && err instanceof VfsError && err.code === 'ENOENT') continue
        stderr += `rm: ${target}: ${reason(err)}\n`
      }
    }
    return { stdout: '', stderr, status: stderr === '' ? 0 : 1 }
  },
}

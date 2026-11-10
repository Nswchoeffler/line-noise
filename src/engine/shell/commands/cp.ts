import { basename } from '../../vfs/index.ts'
import { UsageError, type Program } from '../types.ts'
import { parseArgs, reason } from './util.ts'

export const cp: Program = {
  name: 'cp',
  path: '/bin/cp',
  summary: 'copy files',
  usage: 'cp from to    or    cp file ... directory',
  run(ctx) {
    const { operands } = parseArgs(ctx.args, '')
    if (operands.length < 2) throw new UsageError('needs a file to copy and a place to put it')

    const sources = operands.slice(0, -1)
    const dest = operands[operands.length - 1]!
    const destPath = ctx.resolve(dest)

    let destIsDir = false
    try {
      destIsDir = ctx.fs.tryStat(destPath, ctx.cred)?.kind === 'dir'
    } catch (err) {
      return { stdout: '', stderr: `cp: ${dest}: ${reason(err)}\n`, status: 1 }
    }
    if (sources.length > 1 && !destIsDir) {
      return { stdout: '', stderr: `cp: ${dest}: Not a directory\n`, status: 1 }
    }

    let stderr = ''
    for (const source of sources) {
      const from = ctx.resolve(source)
      const to = destIsDir ? `${destPath}/${basename(from)}` : destPath
      try {
        const stat = ctx.fs.stat(from, ctx.cred)
        if (stat.kind === 'dir') {
          stderr += `cp: ${source}: Is a directory (not copied)\n`
          continue
        }
        if (from === to) {
          stderr += `cp: ${source} and ${dest} are the same file (not copied)\n`
          continue
        }
        const content = ctx.fs.readFile(from, ctx.cred)
        // A new copy belongs to whoever made it. It keeps the permission bits
        // but never the setuid or setgid bits: those must be set on purpose.
        ctx.fs.writeFile(to, content, ctx.cred, {
          mode: stat.mode & 0o777,
          ...(stat.program === undefined ? {} : { program: stat.program, size: stat.size }),
        })
      } catch (err) {
        stderr += `cp: ${source}: ${reason(err)}\n`
      }
    }
    return { stdout: '', stderr, status: stderr === '' ? 0 : 1 }
  },
}

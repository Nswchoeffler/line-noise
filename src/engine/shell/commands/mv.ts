import { basename } from '../../vfs/index.ts'
import { UsageError, type Program } from '../types.ts'
import { parseArgs, reason } from './util.ts'

export const mv: Program = {
  name: 'mv',
  path: '/bin/mv',
  summary: 'move or rename files',
  usage: 'mv from to    or    mv file ... directory',
  run(ctx) {
    const { operands } = parseArgs(ctx.args, 'f')
    if (operands.length < 2) throw new UsageError('needs a file to move and a place to put it')

    const sources = operands.slice(0, -1)
    const dest = operands[operands.length - 1]!
    const destPath = ctx.resolve(dest)

    let destIsDir = false
    try {
      destIsDir = ctx.fs.tryStat(destPath, ctx.cred)?.kind === 'dir'
    } catch (err) {
      return { stdout: '', stderr: `mv: ${dest}: ${reason(err)}\n`, status: 1 }
    }
    if (sources.length > 1 && !destIsDir) {
      return { stdout: '', stderr: `mv: ${dest}: Not a directory\n`, status: 1 }
    }

    let stderr = ''
    for (const source of sources) {
      const from = ctx.resolve(source)
      const to = destIsDir ? `${destPath}/${basename(from)}` : destPath
      try {
        ctx.fs.rename(from, to, ctx.cred)
      } catch (err) {
        stderr += `mv: ${source}: ${reason(err)}\n`
      }
    }
    return { stdout: '', stderr, status: stderr === '' ? 0 : 1 }
  },
}

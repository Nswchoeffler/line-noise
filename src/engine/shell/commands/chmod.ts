import { applyModeSpec, ModeSpecError } from '../../vfs/index.ts'
import { UsageError, type Program } from '../types.ts'
import { reason } from './util.ts'

export const chmod: Program = {
  name: 'chmod',
  path: '/bin/chmod',
  summary: 'change who may read, write or run a file',
  usage: 'chmod mode file ...    (mode like 644, u+x, go-w or u-s)',
  run(ctx) {
    // No option parsing: a mode such as "-x" starts with a dash.
    const [spec, ...files] = ctx.args
    if (spec === undefined || files.length === 0) {
      throw new UsageError('needs a mode and at least one file')
    }

    let stderr = ''
    for (const file of files) {
      const path = ctx.resolve(file)
      try {
        const current = ctx.fs.stat(path, ctx.cred).mode
        ctx.fs.chmod(path, applyModeSpec(current, spec), ctx.cred)
      } catch (err) {
        if (err instanceof ModeSpecError) throw new UsageError(err.message)
        stderr += `chmod: ${file}: ${reason(err)}\n`
      }
    }
    return { stdout: '', stderr, status: stderr === '' ? 0 : 1 }
  },
}

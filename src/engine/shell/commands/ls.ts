import { dirname, formatMode, type Stat } from '../../vfs/index.ts'
import { formatListTime } from '../../world/time.ts'
import type { Program, ProgramContext } from '../types.ts'
import { parseArgs, reason } from './util.ts'

interface Entry {
  name: string
  /** Undefined when the entry exists but cannot be examined. */
  stat: Stat | undefined
}

const SCREEN_WIDTH = 80

function longLine(ctx: ProgramContext, entry: Entry): string {
  const { name, stat } = entry
  if (!stat) return `??????????  ? ?        ?             ?            ? ${name}`
  const users = ctx.host.users
  return [
    formatMode(stat.kind, stat.mode),
    String(stat.kind === 'dir' ? 2 : 1).padStart(2),
    users.userName(stat.uid).padEnd(8),
    users.groupName(stat.gid).padEnd(8),
    String(stat.size).padStart(7),
    formatListTime(stat.mtime, ctx.host.clock.now),
    name,
  ].join(' ')
}

/** Names laid out in columns, filled top to bottom, as ls does on a screen. */
function columns(names: string[]): string {
  if (names.length === 0) return ''
  const width = Math.max(...names.map((n) => n.length)) + 2
  const perRow = Math.max(1, Math.floor(SCREEN_WIDTH / width))
  const rows = Math.ceil(names.length / perRow)
  let out = ''
  for (let r = 0; r < rows; r++) {
    let line = ''
    for (let c = 0; c < perRow; c++) {
      const name = names[c * rows + r]
      if (name !== undefined) line += name.padEnd(width)
    }
    out += line.trimEnd() + '\n'
  }
  return out
}

export const ls: Program = {
  name: 'ls',
  path: '/bin/ls',
  summary: 'list files',
  usage: 'ls [-ladtr] [file ...]',
  run(ctx) {
    const { flags, operands } = parseArgs(ctx.args, 'ladtr1')
    const long = flags.has('l')
    const targets = operands.length > 0 ? operands : ['.']
    let stderr = ''

    const statEntry = (name: string, path: string): Entry => {
      try {
        return { name, stat: ctx.fs.stat(path, ctx.cred) }
      } catch {
        return { name, stat: undefined }
      }
    }

    const order = (entries: Entry[]): Entry[] => {
      const sorted = [...entries]
      if (flags.has('t')) {
        sorted.sort((a, b) => (b.stat?.mtime ?? 0) - (a.stat?.mtime ?? 0) || (a.name < b.name ? -1 : 1))
      }
      if (flags.has('r')) sorted.reverse()
      return sorted
    }

    const render = (entries: Entry[]): string => {
      const sorted = order(entries)
      if (long) return sorted.map((e) => longLine(ctx, e) + '\n').join('')
      const names = sorted.map((e) => e.name)
      return ctx.stdoutIsTTY && !flags.has('1') ? columns(names) : names.map((n) => n + '\n').join('')
    }

    // Plain files (and, with -d, directories themselves) are listed first.
    const files: Entry[] = []
    const dirs: { name: string; path: string }[] = []
    for (const target of targets) {
      const path = ctx.resolve(target)
      try {
        const stat = ctx.fs.stat(path, ctx.cred)
        if (stat.kind === 'dir' && !flags.has('d')) dirs.push({ name: target, path })
        else files.push({ name: target, stat })
      } catch (err) {
        stderr += `ls: ${target}: ${reason(err)}\n`
      }
    }

    const sections: string[] = []
    if (files.length > 0) sections.push(render(files))

    for (const dir of dirs) {
      let names: string[]
      try {
        names = ctx.fs.readdir(dir.path, ctx.cred)
      } catch (err) {
        stderr += `ls: ${dir.name}: ${reason(err)}\n`
        continue
      }
      if (!flags.has('a')) names = names.filter((n) => !n.startsWith('.'))

      const entries = names.map((name) => statEntry(name, `${dir.path}/${name}`))
      if (flags.has('a')) {
        entries.unshift(statEntry('.', dir.path), statEntry('..', dirname(dir.path)))
      }

      let section = ''
      if (targets.length > 1) section += `${dir.name}:\n`
      if (long) {
        const blocks = entries.reduce((sum, e) => sum + Math.ceil((e.stat?.size ?? 0) / 1024), 0)
        section += `total ${blocks}\n`
      }
      sections.push(section + render(entries))
    }

    return { stdout: sections.join('\n'), stderr, status: stderr === '' ? 0 : 1 }
  },
}

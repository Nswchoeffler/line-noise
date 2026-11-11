import type { CommandRecord, Shell } from '../shell/session.ts'
import { basename, normalize, S_ISGID, S_ISUID, S_ISVTX } from '../vfs/index.ts'
import type { World } from '../world/world.ts'
import type { Predicate } from './schema.ts'

/** Everything a predicate may look at. */
export interface PredicateContext {
  world: World
  /** The player's session on each host they have a terminal on. */
  shells: ReadonlyMap<string, Shell>
  /** The host the player's terminal is on now. */
  currentHost: string
  /** Every line the player has entered in this level, oldest first. */
  records: readonly CommandRecord[]
  /** Only lines from this index on count. Guided prompts use it so that an earlier command cannot satisfy a later prompt. */
  from: number
  /** Objectives met so far, with how many lines had been entered when each was met. */
  objectives: ReadonlyMap<string, number>
  /** Logbook entries completed so far. */
  logged: ReadonlySet<string>
  /** Stages of the board puzzle cleared so far. */
  solved: ReadonlySet<string>
}

const BITS = { setuid: S_ISUID, setgid: S_ISGID, sticky: S_ISVTX }

const HISTORY_KEYS = [
  'command_ran',
  'touched',
  'read',
  'wrote',
  'output_contains',
  'output_matches',
  'failed',
  'as',
] as const

function recordMatches(p: Predicate, record: CommandRecord, ctx: PredicateContext): boolean {
  if (p.host !== undefined && record.host !== p.host) return false

  if (p.command_ran !== undefined) {
    const names = typeof p.command_ran === 'string' ? [p.command_ran] : p.command_ran
    const wantFailure = p.failed === true
    // Only commands the player typed count, not ones a script ran for them.
    const typed = record.commands.filter((c) => c.depth === 0)
    for (const name of names) {
      const ran = typed.some(
        (c) => basename(c.argv[0] ?? '') === name && (c.status !== 0) === wantFailure,
      )
      if (!ran) return false
    }
  } else if (p.failed !== undefined && (record.status !== 0) !== p.failed) {
    return false
  }

  if (p.touched !== undefined) {
    const path = normalize(p.touched)
    if (!record.accesses.some((a) => a.path === path)) return false
  }
  if (p.read !== undefined) {
    const path = normalize(p.read)
    if (!record.accesses.some((a) => a.op === 'read' && a.path === path)) return false
  }
  if (p.wrote !== undefined) {
    const path = normalize(p.wrote)
    if (!record.accesses.some((a) => (a.op === 'write' || a.op === 'create') && a.path === path)) {
      return false
    }
  }

  if (p.output_contains !== undefined || p.output_matches !== undefined) {
    const output = record.output.map((chunk) => chunk.text).join('')
    if (p.output_contains !== undefined && !output.includes(p.output_contains)) return false
    if (p.output_matches !== undefined && !new RegExp(p.output_matches, 'm').test(output)) return false
  }

  if (p.as !== undefined) {
    const host = ctx.world.has(record.host) ? ctx.world.host(record.host) : undefined
    if (host?.users.userName(record.euid) !== p.as) return false
  }
  return true
}

/** Does the predicate hold right now? */
export function holds(p: Predicate, ctx: PredicateContext): boolean {
  if (p.all && !p.all.every((inner) => holds(inner, ctx))) return false
  if (p.any && !p.any.some((inner) => holds(inner, ctx))) return false
  if (p.not && holds(p.not, ctx)) return false

  if (p.logged !== undefined && !ctx.logged.has(p.logged)) return false
  if (p.met !== undefined && !ctx.objectives.has(p.met)) return false
  if (p.solved !== undefined && !ctx.solved.has(p.solved)) return false

  // ---- the world right now ----
  const hostName = p.host ?? ctx.currentHost
  const host = ctx.world.has(hostName) ? ctx.world.host(hostName) : undefined
  const shell = ctx.shells.get(hostName)

  if (p.cwd !== undefined && shell?.cwd !== normalize(p.cwd)) return false
  if (p.whoami !== undefined && shell?.user !== p.whoami) return false
  if (p.file_exists !== undefined && host?.fs.inspect(p.file_exists) === undefined) return false
  if (p.file_missing !== undefined && (!host || host.fs.inspect(p.file_missing) !== undefined)) {
    return false
  }
  if (p.file_contains !== undefined) {
    const content = host?.fs.peek(p.file_contains.path)
    if (content === undefined) return false
    const { text, matches } = p.file_contains
    if (text !== undefined && !content.includes(text)) return false
    if (matches !== undefined && !new RegExp(matches, 'm').test(content)) return false
  }
  if (p.mode_has !== undefined) {
    const stat = host?.fs.inspect(p.mode_has.path)
    if (!stat || (stat.mode & BITS[p.mode_has.bit]) === 0) return false
  }
  if (p.mode_lacks !== undefined) {
    const stat = host?.fs.inspect(p.mode_lacks.path)
    if (!stat || (stat.mode & BITS[p.mode_lacks.bit]) !== 0) return false
  }
  if (p.owner_is !== undefined) {
    const stat = host?.fs.inspect(p.owner_is.path)
    const user = host?.users.byName(p.owner_is.user)
    if (!stat || !user || stat.uid !== user.uid) return false
  }

  // ---- what the player did ----
  if (HISTORY_KEYS.some((key) => p[key] !== undefined)) {
    let start = ctx.from
    if (p.after !== undefined) {
      const metAt = ctx.objectives.get(p.after)
      if (metAt === undefined) return false
      start = Math.max(start, metAt)
    }
    let found = false
    for (let i = start; i < ctx.records.length; i++) {
      if (recordMatches(p, ctx.records[i]!, ctx)) {
        found = true
        break
      }
    }
    if (!found) return false
  }

  return true
}

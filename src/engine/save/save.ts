// Saved progress, as text. A save is small: which levels are done, and for the
// level in progress, everything the player has done in it. Playing those
// events back rebuilds the level exactly, because the engine is deterministic,
// so no part of the simulated world needs to be stored.

import { z } from 'zod'
import type { LevelEvent } from '../levels/runner.ts'
import { ENGINE_VERSION } from '../version.ts'

/** Goes up whenever the shape of a save changes. Add a migration when it does. */
export const SAVE_VERSION = 1

export interface SaveData {
  /** Ids of completed levels, in the order they were completed. */
  completed: string[]
  /** The level in progress, and everything the player has done in it. */
  current: { level: string; events: LevelEvent[] } | null
}

const AnswerSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('fill'), values: z.record(z.string(), z.string()) }),
  z.strictObject({ kind: z.literal('choose'), chosen: z.array(z.string()) }),
  z.strictObject({ kind: z.literal('pin'), text: z.string(), source: z.string() }),
  z.strictObject({ kind: z.literal('write'), text: z.string() }),
])

const EventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('begin') }),
  z.strictObject({ type: z.literal('command'), line: z.string() }),
  z.strictObject({ type: z.literal('continue') }),
  z.strictObject({ type: z.literal('answer'), entry: z.string(), answer: AnswerSchema }),
])

const SaveSchema = z.object({
  version: z.literal(SAVE_VERSION),
  completed: z.array(z.string()),
  current: z.strictObject({ level: z.string(), events: z.array(EventSchema) }).nullable(),
})

/**
 * Brings a save written by an older version up by one version. Keyed by the
 * version it upgrades from: the entry at 1 turns a version 1 save into a
 * version 2 save.
 */
export type Migration = (old: Record<string, unknown>) => Record<string, unknown>

const MIGRATIONS: Readonly<Record<number, Migration>> = {}

/** A save as text, stamped with the save version and the build that wrote it. */
export function encodeSave(data: SaveData): string {
  return JSON.stringify({
    version: SAVE_VERSION,
    engine: ENGINE_VERSION,
    completed: data.completed,
    current: data.current,
  })
}

/**
 * Read a save back. Older saves are migrated forward. Anything that cannot be
 * trusted (missing, damaged, or written by a newer version of the game) gives
 * null, and the game starts fresh rather than guessing.
 */
export function decodeSave(
  text: string | null | undefined,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
): SaveData | null {
  if (text === null || text === undefined || text === '') return null

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null

  let save = raw as Record<string, unknown>
  let version = save['version']
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0 || version > SAVE_VERSION) return null
  while (version < SAVE_VERSION) {
    const migrate: Migration | undefined = migrations[version]
    if (!migrate) return null
    try {
      save = { ...migrate(save), version: version + 1 }
    } catch {
      return null
    }
    version += 1
  }

  const parsed = SaveSchema.safeParse(save)
  if (!parsed.success) return null
  return { completed: parsed.data.completed, current: parsed.data.current }
}

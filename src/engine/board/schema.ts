// The data format for a board puzzle: a place made of rooms whose doors open
// only for certain badges, a courier who carries cards, and a round on which
// somebody does whatever the card in a certain spot says.
//
// It is the permission model again, with the computer taken away. A door is a
// permission check; a badge is an identity; a courier with a loaned badge acts
// with someone else's authority; the round is work done on a timer with full
// authority. A card may also be something found, not written: a note left
// lying about, which tells whoever reads it a code that opens a door. A code
// is one more badge. What the pieces are called, and every word the player
// reads, is in the level file. Nothing here knows any story.

import { z } from 'zod'

/** Drop the entries a patch has switched off by setting them to null. */
function withoutNulls<T>(record: Record<string, T | null>): Record<string, T> {
  const kept: Record<string, T> = {}
  for (const [key, value] of Object.entries(record)) if (value !== null) kept[key] = value
  return kept
}

const RoomSchema = z.strictObject({
  name: z.string(),
  /** Badges the door opens for. */
  opens_for: z.array(z.string()).min(1),
})

/** Somewhere a card can be put: a noticeboard, a hook, a tray. */
const SpotSchema = z.strictObject({
  name: z.string(),
  room: z.string(),
  /** The card there to begin with, by kind. */
  holds: z.string().nullable().default(null),
  /** When that card was put there, in whatever words suit: "March", "02:00". Play replaces it with the clock. */
  changed: z.string().nullable().default(null),
  /**
   * What is here cannot be read from across the board: a drawer, a
   * pigeonhole. The player has to be in the room and look.
   */
  covered: z.boolean().default(false),
})

/** A kind of card: one the player can write, or one that is found lying about. */
const CardSchema = z.strictObject({
  text: z.string(),
  /** What following the card does: hand a badge to the player, if they are in this room. */
  grants: z.strictObject({ badge: z.string(), in: z.string() }).optional(),
  /** What reading the card tells the reader: a code, which is held like a badge from then on. */
  tells: z.string().optional(),
  /** Somebody else's card, there to be found. The player cannot write one. */
  found: z.boolean().default(false),
})

const CourierSchema = z.strictObject({
  name: z.string(),
  /** A line about them, shown on the board. */
  about: z.string().optional(),
  /** Where they wait for cards. */
  room: z.string(),
  /** A badge of their own, on loan. Without one they carry the sender's. */
  badge: z.string().nullable().default(null),
  /** Whether they first check that the sender could have gone there themselves. */
  asks: z.boolean().default(false),
})

const RoundSchema = z.strictObject({
  name: z.string(),
  about: z.string().optional(),
  badge: z.string(),
  /** Minutes between rounds. */
  every: z.number().int().positive(),
  /** The spot whose card is followed on each round. */
  reads: z.string(),
})

/**
 * Every sentence the board can print, with {placeholders} the engine fills
 * in. A board must supply each one it could ever print, so that it can never
 * print something unwritten: see `neededLines`.
 */
export const LINE_KEYS = [
  'you_enter', // {badge} {room}
  'you_refused', // {badge} {room}
  'you_read', // {spot} {room} {card}
  'you_learn', // {badge}
  'you_write', // {card}
  'you_place', // {spot} {room}
  'you_replace', // {spot} {room} {old}
  'you_hand', // {courier} {spot} {room}
  'courier_loaned', // {courier} {badge}
  'courier_senders', // {courier} {badge}
  'courier_declines', // {courier} {badge} {room}
  'courier_enters', // {courier} {badge} {room}
  'courier_refused', // {courier} {badge} {room}
  'courier_delivers', // {courier} {spot} {room}
  'courier_replaces', // {courier} {spot} {room} {old}
  'round_reads', // {time} {round} {spot} {card}
  'round_empty', // {time} {round} {spot}
  'round_refused', // {time} {round} {room}
  'round_does', // {round}
  'round_grants', // {round} {badge} {room}
  'round_misses', // {round} {badge} {room}
  'fix_change', // {change}
  'fix_try',
  'fix_worked',
  'fix_held',
] as const

export type LineKey = (typeof LINE_KEYS)[number]

const LinesSchema = z.strictObject(
  Object.fromEntries(LINE_KEYS.map((key) => [key, z.string().optional()])) as Record<
    LineKey,
    z.ZodOptional<z.ZodString>
  >,
)

const FIX_LINES: readonly LineKey[] = ['fix_change', 'fix_try', 'fix_worked', 'fix_held']

/** The sentences a board could print, given what is on it. */
function neededLines(board: {
  spots: Record<string, { covered: boolean }>
  cards: Record<string, { found: boolean }>
  courier: unknown
  round: unknown
}): LineKey[] {
  const needed: LineKey[] = ['you_enter', 'you_refused']
  const spots = Object.values(board.spots)
  const writes = spots.length > 0 && Object.values(board.cards).some((card) => !card.found)
  if (spots.some((spot) => spot.covered)) needed.push('you_read', 'you_learn')
  if (writes) needed.push('you_write', 'you_place', 'you_replace')
  if (writes && board.courier !== null) {
    needed.push(...LINE_KEYS.filter((key) => key === 'you_hand' || key.startsWith('courier_')))
  }
  if (board.round !== null) needed.push(...LINE_KEYS.filter((key) => key.startsWith('round_')))
  return needed
}

export const BoardSpecSchema = z
  .strictObject({
    /** Badge names by id: `master: MASTER`. */
    badges: z.record(z.string(), z.string()),
    rooms: z.record(z.string(), RoomSchema.nullable()).transform(withoutNulls),
    spots: z.record(z.string(), SpotSchema.nullable()).default({}).transform(withoutNulls),
    cards: z.record(z.string(), CardSchema.nullable()).default({}).transform(withoutNulls),
    player: z.strictObject({ room: z.string(), badges: z.array(z.string()).min(1) }),
    courier: CourierSchema.nullable().default(null),
    round: RoundSchema.nullable().default(null),
    /** What the clock reads to begin with, as hh:mm. */
    start: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'a time of day looks like 02:00')
      .default('00:00'),
    lines: LinesSchema,
  })
  .superRefine((board, ctx) => {
    const check = (kind: string, id: string, known: Record<string, unknown>, where: string): void => {
      if (!(id in known)) ctx.addIssue({ code: 'custom', message: `${where}: no ${kind} called "${id}"` })
    }
    for (const [id, room] of Object.entries(board.rooms)) {
      for (const badge of room.opens_for) check('badge', badge, board.badges, `room ${id}`)
    }
    for (const [id, spot] of Object.entries(board.spots)) {
      check('room', spot.room, board.rooms, `spot ${id}`)
      if (spot.holds !== null) check('card', spot.holds, board.cards, `spot ${id}`)
    }
    for (const [id, card] of Object.entries(board.cards)) {
      if (card.tells !== undefined) check('badge', card.tells, board.badges, `card ${id}`)
      if (!card.grants) continue
      check('badge', card.grants.badge, board.badges, `card ${id}`)
      check('room', card.grants.in, board.rooms, `card ${id}`)
    }
    check('room', board.player.room, board.rooms, 'player')
    for (const badge of board.player.badges) check('badge', badge, board.badges, 'player')
    if (board.courier) {
      check('room', board.courier.room, board.rooms, 'courier')
      if (board.courier.badge !== null) check('badge', board.courier.badge, board.badges, 'courier')
    }
    if (board.round) {
      check('badge', board.round.badge, board.badges, 'round')
      check('spot', board.round.reads, board.spots, 'round')
    }
    for (const key of neededLines(board)) {
      if (board.lines[key] === undefined) {
        ctx.addIssue({ code: 'custom', message: `lines: this board can print "${key}", which is not written` })
      }
    }
  })

export type BoardSpec = z.infer<typeof BoardSpecSchema>

// ---- moves --------------------------------------------------------------------

/** Everything the player can do at the board. */
export const MoveSchema = z.discriminatedUnion('do', [
  /** Walk to a room. Its door reads the player's badge. */
  z.strictObject({ do: z.literal('go'), room: z.string() }),
  /** Look at what is on a covered spot in the room the player is in. */
  z.strictObject({ do: z.literal('read'), spot: z.string() }),
  /** Write a card of some kind. It is now in the player's hand. */
  z.strictObject({ do: z.literal('write'), card: z.string() }),
  /** Put the card in hand on a spot in the room the player is in. */
  z.strictObject({ do: z.literal('place'), spot: z.string() }),
  /** Hand the card to the courier, to be taken to a spot. */
  z.strictObject({ do: z.literal('send'), spot: z.string() }),
  /** Wait for the next round. */
  z.strictObject({ do: z.literal('wait') }),
  /** In a fix stage: make one change to the board and see whether the trick still works. */
  z.strictObject({ do: z.literal('fix'), change: z.string() }),
  /** Start the stage again. */
  z.strictObject({ do: z.literal('reset') }),
])

export type Move = z.infer<typeof MoveSchema>

// ---- conditions ---------------------------------------------------------------

/** A question about the board as it stands. Every key given must hold. */
export const ConditionSchema = z
  .strictObject({
    player_in: z.string().optional(),
    player_has: z.string().optional(),
    spot_holds: z.strictObject({ spot: z.string(), card: z.string() }).optional(),
    /** A door has refused the player at least once. */
    turned_away: z.string().optional(),
  })
  .refine((c) => Object.values(c).some((v) => v !== undefined), { message: 'a condition must check something' })

export type Condition = z.infer<typeof ConditionSchema>

// ---- stages and the puzzle ------------------------------------------------------

/** Changes to a board, laid over it key by key. `null` switches something off. */
const PatchSchema = z.record(z.string(), z.unknown())

const FixSchema = z.strictObject({
  /** What the intruder does. Played against the board after each change. */
  trick: z.array(MoveSchema).min(1),
  /** The trick has worked if all of these hold when it has been played. */
  works_when: z.array(ConditionSchema).min(1),
  /** The changes on offer. None is marked right or wrong: the rules decide. */
  changes: z.record(z.string(), z.strictObject({ text: z.string(), set: PatchSchema })),
})

const StageSchema = z
  .strictObject({
    id: z.string(),
    title: z.string(),
    /** What the player is trying to do, in plain words. */
    goal: z.string(),
    /** How this stage's board differs from the puzzle's. */
    with: PatchSchema.default({}),
    /** A stage played by hand is cleared when all of these hold. */
    done: z.array(ConditionSchema).min(1).optional(),
    /** A fix stage is cleared when a change stops the trick. */
    fix: FixSchema.optional(),
    /** Free hints, gentlest first. */
    hints: z.array(z.string()).default([]),
  })
  .refine((s) => (s.done === undefined) !== (s.fix === undefined), {
    message: 'a stage needs exactly one of: done, fix',
  })

export type Stage = z.infer<typeof StageSchema>

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Lay a patch over a value: objects merge key by key, anything else is replaced. */
function patched(base: unknown, patch: unknown): unknown {
  if (!isPlain(base) || !isPlain(patch)) return patch
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) result[key] = patched(base[key], value)
  return result
}

function applyPatch(board: BoardSpec, patch: Record<string, unknown>, label: string): BoardSpec {
  const result = BoardSpecSchema.safeParse(patched(board, patch))
  if (!result.success) throw new Error(`${label}:\n${z.prettifyError(result.error)}`)
  return result.data
}

/** The board a stage is played on: the puzzle's board, the stage's differences, then one change if given. */
export function boardFor(puzzle: { board: BoardSpec }, stage: Stage, change?: string): BoardSpec {
  const board = applyPatch(puzzle.board, stage.with, `stage ${stage.id}`)
  if (change === undefined) return board
  const chosen = stage.fix?.changes[change]
  if (!chosen) throw new Error(`stage ${stage.id}: no change called "${change}"`)
  return applyPatch(board, chosen.set, `stage ${stage.id}, change ${change}`)
}

function conditionProblems(condition: Condition, board: BoardSpec): string[] {
  const problems: string[] = []
  const need = (kind: string, id: string | undefined, known: Record<string, unknown>): void => {
    if (id !== undefined && !(id in known)) problems.push(`no ${kind} called "${id}"`)
  }
  need('room', condition.player_in, board.rooms)
  need('badge', condition.player_has, board.badges)
  need('room', condition.turned_away, board.rooms)
  need('spot', condition.spot_holds?.spot, board.spots)
  need('card', condition.spot_holds?.card, board.cards)
  return problems
}

export const PuzzleSchema = z
  .strictObject({
    title: z.string(),
    /** What one stage is called when they are counted: "Part 2 of 5". */
    step: z.string().default('Part'),
    board: BoardSpecSchema,
    stages: z.array(StageSchema).min(1),
  })
  .superRefine((puzzle, ctx) => {
    const fail = (message: string): void => {
      ctx.addIssue({ code: 'custom', message })
    }
    const ids = puzzle.stages.map((s) => s.id)
    for (const id of ids.filter((s, i) => ids.indexOf(s) !== i)) fail(`stage id used twice: ${id}`)

    for (const stage of puzzle.stages) {
      const boards: BoardSpec[] = []
      try {
        boards.push(boardFor(puzzle, stage))
        for (const change of Object.keys(stage.fix?.changes ?? {})) boards.push(boardFor(puzzle, stage, change))
      } catch (err) {
        fail((err as Error).message)
        continue
      }
      const conditions = stage.done ?? stage.fix?.works_when ?? []
      for (const board of boards) {
        for (const condition of conditions) {
          for (const problem of conditionProblems(condition, board)) fail(`stage ${stage.id}: ${problem}`)
        }
      }
      if (stage.fix && Object.keys(stage.fix.changes).length < 2) {
        fail(`stage ${stage.id}: a fix stage needs at least two changes to choose from`)
      }
      if (stage.fix) {
        for (const key of FIX_LINES) {
          if (boards.some((board) => board.lines[key] === undefined)) {
            fail(`stage ${stage.id}: a fix stage prints "${key}", which is not written`)
          }
        }
      }
    }
  })

export type Puzzle = z.infer<typeof PuzzleSchema>

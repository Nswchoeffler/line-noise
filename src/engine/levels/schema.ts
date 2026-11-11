// The level file format. Levels are data: everything a level says, asks and
// checks is described in YAML and validated here. Nothing in the engine knows
// any particular level.

import { z } from 'zod'
import { PuzzleSchema } from '../board/schema.ts'
import { OverlaySpecSchema, TimeSchema } from '../world/spec.ts'

// ---- predicates -------------------------------------------------------------
//
// A predicate is a question about the game: the state of the world, what the
// player has done, or what they have written in the logbook. Objectives and
// guided prompts are both predicates. They never compare command text.
//
// All keys given in one predicate must hold together. The "what the player
// did" keys (command_ran, touched, read, wrote, output_*, failed, as) must all
// hold for the same entered line.

const ModeBit = z.enum(['setuid', 'setgid', 'sticky'])

export interface Predicate {
  /** Which host this is about. Defaults to the host the player is on. */
  host?: string | undefined

  // The world right now.
  /** The player's working directory. */
  cwd?: string | undefined
  /** The user the player's shell is acting as. */
  whoami?: string | undefined
  file_exists?: string | undefined
  file_missing?: string | undefined
  file_contains?: { path: string; text?: string | undefined; matches?: string | undefined } | undefined
  mode_has?: { path: string; bit: z.infer<typeof ModeBit> } | undefined
  mode_lacks?: { path: string; bit: z.infer<typeof ModeBit> } | undefined
  owner_is?: { path: string; user: string } | undefined

  // What the player did, in one entered line.
  /** A command (or all of several, as in a pipeline) ran successfully. */
  command_ran?: string | string[] | undefined
  /** A path was looked at or changed in any way. */
  touched?: string | undefined
  /** A file's contents were read. */
  read?: string | undefined
  /** A file was created or written. */
  wrote?: string | undefined
  output_contains?: string | undefined
  output_matches?: string | undefined
  /** True: the line failed. With command_ran: that command failed. */
  failed?: boolean | undefined
  /** The user the line ran as. */
  as?: string | undefined
  /** Only count lines entered after this objective was met. */
  after?: string | undefined

  // The logbook and other objectives.
  /** A logbook entry has been completed. */
  logged?: string | undefined
  /** Another objective has been met. */
  met?: string | undefined
  /** A stage of the level's board puzzle has been cleared. */
  solved?: string | undefined

  // Combining.
  all?: Predicate[] | undefined
  any?: Predicate[] | undefined
  not?: Predicate | undefined
}

const pathAndBit = z.strictObject({ path: z.string().startsWith('/'), bit: ModeBit })

export const PredicateSchema: z.ZodType<Predicate> = z.lazy(() =>
  z
    .strictObject({
      host: z.string().optional(),
      cwd: z.string().startsWith('/').optional(),
      whoami: z.string().optional(),
      file_exists: z.string().startsWith('/').optional(),
      file_missing: z.string().startsWith('/').optional(),
      file_contains: z
        .strictObject({
          path: z.string().startsWith('/'),
          text: z.string().optional(),
          matches: z.string().optional(),
        })
        .optional(),
      mode_has: pathAndBit.optional(),
      mode_lacks: pathAndBit.optional(),
      owner_is: z.strictObject({ path: z.string().startsWith('/'), user: z.string() }).optional(),
      command_ran: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
      touched: z.string().startsWith('/').optional(),
      read: z.string().startsWith('/').optional(),
      wrote: z.string().startsWith('/').optional(),
      output_contains: z.string().optional(),
      output_matches: z.string().optional(),
      failed: z.boolean().optional(),
      as: z.string().optional(),
      after: z.string().optional(),
      logged: z.string().optional(),
      met: z.string().optional(),
      solved: z.string().optional(),
      all: z.array(PredicateSchema).min(1).optional(),
      any: z.array(PredicateSchema).min(1).optional(),
      not: PredicateSchema.optional(),
    })
    .refine((p) => Object.keys(p).some((key) => key !== 'host' && key !== 'after'), {
      message: 'a predicate must check something',
    }),
)

// ---- beats ------------------------------------------------------------------
//
// Beats are the script of a guided level, played in order. Each is an object
// with exactly one key naming its kind.

/** Someone speaks. The player reads it and continues. */
const SayBeat = z.strictObject({
  say: z.strictObject({ who: z.string(), text: z.string() }),
})

/**
 * A command is suggested and explained, then the player types it. The beat
 * is done when `done` holds, however the player got there. Without `done`,
 * it is done when the suggested program runs successfully.
 */
const PromptBeat = z.strictObject({
  prompt: z.strictObject({
    who: z.string().optional(),
    /** What the player is trying to do, in plain words. */
    goal: z.string(),
    /** The command to type. */
    run: z.string(),
    /** What the command does, piece by piece. Shown before it is typed. */
    explain: z.string(),
    /**
     * What the output means. Shown once the step is done, at the top of
     * whatever comes next, so the player can read it beside the output.
     */
    result: z.string().optional(),
    done: PredicateSchema.optional(),
  }),
})

/** The player fills in a logbook entry before going on. */
const LogBeat = z.strictObject({
  log: z.strictObject({ entry: z.string(), who: z.string().optional(), text: z.string().optional() }),
})

/** Time passes when the player continues. */
const AdvanceBeat = z.strictObject({
  advance: z.strictObject({ seconds: z.number().int().positive(), text: z.string() }),
})

/** Something lands in the printout tray. */
const DeliverBeat = z.strictObject({
  deliver: z.strictObject({ item: z.string() }),
})

/** The terminal moves to another host. */
const ConnectBeat = z.strictObject({
  connect: z.strictObject({ host: z.string(), user: z.string().optional() }),
})

/**
 * The player works one stage of the level's board puzzle. The board takes the
 * terminal's place until the stage is cleared, however many moves that takes.
 */
const PuzzleBeat = z.strictObject({
  puzzle: z.strictObject({ stage: z.string(), who: z.string().optional() }),
})

export const BeatSchema = z.union([
  SayBeat,
  PromptBeat,
  LogBeat,
  AdvanceBeat,
  DeliverBeat,
  ConnectBeat,
  PuzzleBeat,
])

// ---- objectives -------------------------------------------------------------

export const ObjectiveSchema = z.strictObject({
  id: z.string(),
  /** Shown in the goals list. */
  text: z.string(),
  when: PredicateSchema,
})

// ---- logbook ----------------------------------------------------------------

/** One blank in a fill-in-the-blank sentence. Any one way of matching may be used. */
const BlankSchema = z
  .strictObject({
    /** Accepted answers. Case and extra spaces are ignored. */
    accept: z.array(z.string()).min(1).optional(),
    /** A regular expression the answer must match, ignoring case. */
    matches: z.string().optional(),
    /** A number, with an allowed margin either way. */
    number: z.strictObject({ value: z.number(), tolerance: z.number().min(0).default(0) }).optional(),
    /** Where to look. Shown on request, and after a wrong answer. Never gives the answer away. */
    hint: z.string().optional(),
    /** What goes in the blank, shown under it: "account name", "hh:mm". */
    label: z.string().optional(),
    /** Width of the blank in characters. */
    width: z.number().int().positive().default(12),
  })
  .refine((b) => [b.accept, b.matches, b.number].filter((x) => x !== undefined).length === 1, {
    message: 'a blank needs exactly one of: accept, matches, number',
  })

/** A sentence with named blanks: "The account {account} has no billing record." */
const FillEntry = z.strictObject({
  id: z.string(),
  fill: z.string(),
  blanks: z.record(z.string(), BlankSchema),
})

/** Pick some of a list. */
const ChooseEntry = z.strictObject({
  id: z.string(),
  ask: z.string(),
  choose: z.number().int().positive(),
  options: z.array(z.strictObject({ id: z.string(), text: z.string() })).min(2),
  correct: z.array(z.string()).min(1),
  hint: z.string().optional(),
})

/** Pin a line from the terminal or a printout as evidence. */
const PinEntry = z.strictObject({
  id: z.string(),
  ask: z.string(),
  pin: z.strictObject({ matches: z.string() }),
  hint: z.string().optional(),
})

/** Write a sentence. Accepted when it mentions each required idea. */
const WriteEntry = z.strictObject({
  id: z.string(),
  ask: z.string(),
  write: z.strictObject({
    /** Each inner list is one idea; the sentence must contain any one of its words. */
    mentions: z.array(z.array(z.string()).min(1)).min(1),
  }),
  hint: z.string().optional(),
})

export const LogbookEntrySchema = z.union([FillEntry, ChooseEntry, PinEntry, WriteEntry])

// ---- tray items, cards ------------------------------------------------------

/** Something in the printout tray that is written out in the level file. */
export const TrayItemSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  /** `printout` is fan-fold printer paper; `note` is a handwritten slip. */
  kind: z.enum(['printout', 'note']).default('printout'),
  text: z.string(),
})

/** The debrief card a level leaves in the binder. */
export const CardSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  /** The idea, in two sentences. */
  concept: z.string(),
  /** What it looks like in present-day systems. */
  today: z.string(),
  /** One real-world note. The only place real history is named. */
  note: z.string(),
  /** Where the real-world note comes from. Required: every historical claim needs a source. */
  source: z.strictObject({ text: z.string(), url: z.string().url() }),
  /** Where the simulation simplifies the era. */
  simplified: z.string().optional(),
  /** Security+ exam domains this level touches. */
  domains: z.array(z.string()).default([]),
  /** Commands this level introduced. */
  commands: z.array(z.string()).default([]),
})

// ---- the level --------------------------------------------------------------

export const LevelSchema = z
  .strictObject({
    id: z.string().regex(/^L\d{2}-[a-z0-9-]+$/, 'level ids look like L01-the-discrepancy'),
    number: z.number().int().positive(),
    title: z.string(),
    /** How much help the interface gives. The engine treats all three alike. */
    mode: z.enum(['guided', 'scaffolded', 'open']),
    /** Where the player's terminal starts. */
    host: z.string(),
    /** The account the player works as. */
    user: z.string(),

    /** How the world differs when this level starts. Applied on top of every earlier level. */
    setup: z
      .strictObject({
        /** The clock is moved forward to this time. */
        time: TimeSchema.optional(),
        /** New hosts made as copies of existing ones: `sandbox: granite`. */
        clone: z.record(z.string(), z.string()).default({}),
        /** Changes to hosts, by host name. */
        overlays: z.record(z.string(), OverlaySpecSchema).default({}),
        /** Scripted sessions to play out before the level starts, by file. */
        sessions: z.array(z.string()).default([]),
      })
      .default({ clone: {}, overlays: {}, sessions: [] }),

    /** The situation, shown before play begins. */
    brief: z.string(),
    /** Items available to the printout tray, delivered by `deliver` beats. */
    tray: z.array(TrayItemSchema).default([]),
    /** A board puzzle, worked a stage at a time by `puzzle` beats. */
    puzzle: PuzzleSchema.optional(),
    beats: z.array(BeatSchema).default([]),
    objectives: z.array(ObjectiveSchema).default([]),
    logbook: z.array(LogbookEntrySchema).default([]),
    /** Hint ladders, used from scaffolded mode on. */
    hints: z.array(z.unknown()).default([]),
    /** The debrief card, by file. */
    debrief: z.string(),
  })
  .superRefine((level, ctx) => {
    const fail = (message: string): void => {
      ctx.addIssue({ code: 'custom', message })
    }
    const duplicates = (ids: string[]): string[] => ids.filter((id, i) => ids.indexOf(id) !== i)

    const objectiveIds = level.objectives.map((o) => o.id)
    const entryIds = level.logbook.map((e) => e.id)
    for (const id of duplicates(objectiveIds)) fail(`objective id used twice: ${id}`)
    for (const id of duplicates(entryIds)) fail(`logbook entry id used twice: ${id}`)

    for (const entry of level.logbook) {
      if ('fill' in entry) {
        const named = [...entry.fill.matchAll(/\{([a-z0-9_]+)\}/g)].map((m) => m[1]!)
        for (const name of named) {
          if (!(name in entry.blanks)) fail(`logbook ${entry.id}: no blank defined for {${name}}`)
        }
        for (const name of Object.keys(entry.blanks)) {
          if (!named.includes(name)) fail(`logbook ${entry.id}: blank "${name}" is not in the sentence`)
        }
        if (named.length === 0) fail(`logbook ${entry.id}: the sentence has no blanks`)
      }
      if ('choose' in entry) {
        const optionIds = entry.options.map((o) => o.id)
        for (const id of entry.correct) {
          if (!optionIds.includes(id)) fail(`logbook ${entry.id}: correct answer "${id}" is not an option`)
        }
        if (entry.correct.length !== entry.choose) {
          fail(`logbook ${entry.id}: asks for ${entry.choose} but ${entry.correct.length} are correct`)
        }
      }
    }

    const stageIds = level.puzzle?.stages.map((s) => s.id) ?? []
    const played = level.beats.flatMap((beat) => ('puzzle' in beat ? [beat.puzzle.stage] : []))
    for (const id of played) {
      if (!stageIds.includes(id)) fail(`a beat plays puzzle stage "${id}", which does not exist`)
    }
    for (const id of duplicates(played)) fail(`puzzle stage played twice: ${id}`)
    for (const objective of level.objectives) {
      const stage = objective.when.solved
      if (stage !== undefined && !played.includes(stage)) {
        fail(`objective ${objective.id} waits for puzzle stage "${stage}", which no beat plays`)
      }
    }

    const trayIds = level.tray.map((t) => t.id)
    for (const beat of level.beats) {
      if ('log' in beat && !entryIds.includes(beat.log.entry)) {
        fail(`a beat refers to logbook entry "${beat.log.entry}", which does not exist`)
      }
      if ('deliver' in beat && !trayIds.includes(beat.deliver.item)) {
        // Items produced by scripted sessions are checked when the level is loaded.
        if (level.setup.sessions.length === 0) {
          fail(`a beat delivers "${beat.deliver.item}", which is not in the tray list`)
        }
      }
    }
  })

export type Beat = z.infer<typeof BeatSchema>
export type Objective = z.infer<typeof ObjectiveSchema>
export type LogbookEntry = z.infer<typeof LogbookEntrySchema>
export type Blank = z.infer<typeof BlankSchema>
export type TrayItem = z.infer<typeof TrayItemSchema>
export type Card = z.infer<typeof CardSchema>
export type Level = z.infer<typeof LevelSchema>
export type GuidanceMode = Level['mode']

import { playMove, stageMoves, startStage, type StagePlay } from '../board/board.ts'
import type { Move, Stage } from '../board/schema.ts'
import type { ShellEnv } from '../shell/exec.ts'
import { Shell, type CommandRecord } from '../shell/session.ts'
import type { ProgramRegistry } from '../shell/types.ts'
import { applyOverlay } from '../world/build.ts'
import type { World } from '../world/world.ts'
import type { LoadedLevel } from './loader.ts'
import { grade, type Answer, type Grade } from './logbook.ts'
import { holds, type PredicateContext } from './predicates.ts'
import type { Beat, LogbookEntry, Predicate, TrayItem } from './schema.ts'

/**
 * Everything the player can do in a level. A level's whole history is a list
 * of these, and playing the list back rebuilds the level exactly: that is how
 * progress is saved.
 */
export type LevelEvent =
  | { type: 'begin' }
  | { type: 'command'; line: string }
  | { type: 'continue' }
  | { type: 'answer'; entry: string; answer: Answer }
  | { type: 'move'; move: Move }

export type Phase = 'brief' | 'play' | 'debrief'

/** The stage of the board puzzle the player reached most recently. */
export interface PuzzleView {
  /** The puzzle's title, and what it calls one stage. */
  title: string
  step: string
  stage: Stage
  /** Which stage this is, counting from one, and how many there are. */
  number: number
  of: number
  play: StagePlay
  /** The moves open right now. Empty unless this stage is the current beat. */
  moves: Move[]
}

export interface LogbookEntryState {
  entry: LogbookEntry
  /** False until the level reaches the point where this entry is asked for. */
  open: boolean
  answer: Answer | null
  grade: Grade | null
  complete: boolean
}

export interface LevelState {
  phase: Phase
  /** The host the terminal is attached to. */
  host: string
  beatIndex: number
  /** The beat waiting on the player, or null when the script has run out. */
  beat: Beat | null
  /** Lines entered since the current beat began. */
  attempts: number
  objectives: { id: string; text: string; met: boolean }[]
  logbook: LogbookEntryState[]
  /** What has been delivered to the printout tray so far. */
  tray: TrayItem[]
  /** The board puzzle as it stands, once the level has reached it. */
  puzzle: PuzzleView | null
  complete: boolean
}

/** What a terminal needs from whatever it is attached to. */
export interface TerminalBackend {
  readonly prompt: string
  readonly history: readonly string[]
  readonly env: ShellEnv
  run: (line: string) => CommandRecord
}

export interface LevelSessionOptions {
  loaded: LoadedLevel
  /** The world as it stands at the start of this level. */
  world: World
  programs: ProgramRegistry
  /** The terminal the player sits at. */
  tty?: string
}

/** Program names in a suggested command line: `cut ... | sort | uniq -c` → cut, sort, uniq. */
function programsIn(line: string): string[] {
  return line
    .split(/[|;]/)
    .map((part) => part.trim().split(/\s+/)[0] ?? '')
    .filter((name) => name !== '')
    .map((name) => name.slice(name.lastIndexOf('/') + 1))
}

/**
 * One play-through of one level. It owns the player's shells, runs the
 * level's beats in order, latches objectives as they are met, marks logbook
 * answers, and says when the level is complete.
 */
export class LevelSession implements TerminalBackend {
  readonly loaded: LoadedLevel
  readonly world: World
  readonly events: LevelEvent[] = []

  private readonly programs: ProgramRegistry
  private readonly tty: string
  private readonly shells = new Map<string, Shell>()
  private readonly listeners = new Set<() => void>()

  private phase: Phase = 'brief'
  private host: string
  private beatIndex = 0
  /** Whether the current beat's one-time effects have been applied. */
  private entered = false
  /** Index into `records` where the current beat began. */
  private beatFrom = 0
  /** Set when the player presses Continue; consumed by the current beat. */
  private continued = false
  private readonly records: CommandRecord[] = []
  private readonly met = new Map<string, number>()
  private readonly answers = new Map<string, { answer: Answer; grade: Grade }>()
  private readonly delivered: TrayItem[] = []
  /** Puzzle stages reached so far, by id, and the one reached last. */
  private readonly stages = new Map<string, StagePlay>()
  private latestStage: string | null = null
  private state: LevelState

  constructor(options: LevelSessionOptions) {
    this.loaded = options.loaded
    this.world = options.world
    this.programs = options.programs
    this.tty = options.tty ?? 'ttyp0'
    this.host = options.loaded.level.host
    this.login(this.host, options.loaded.level.user)
    this.state = this.buildState()
  }

  // ---- shells -----------------------------------------------------------------

  /** Log the player in on a host, recording the login the way the host would. */
  private login(hostName: string, user: string): Shell {
    const existing = this.shells.get(hostName)
    if (existing) return existing
    const host = this.world.host(hostName)
    applyOverlay(host, {
      remove: [],
      dirs: [],
      files: [],
      touch: [],
      logins: [{ user, tty: this.tty, from: '', login: this.world.clock.now }],
      processes: [],
      endProcesses: [],
    })
    const shell = Shell.login({ host, programs: this.programs, user, tty: this.tty })
    this.shells.set(hostName, shell)
    return shell
  }

  /** The shell the terminal is attached to. */
  get shell(): Shell {
    return this.shells.get(this.host)!
  }

  // The session is itself what the terminal attaches to, so the terminal
  // follows the player from host to host without being told.

  get prompt(): string {
    return this.shell.prompt
  }

  /** Lines typed on the current host, for recall with the arrow keys. */
  get history(): readonly string[] {
    return this.shell.history
  }

  get env(): ShellEnv {
    return this.shell.env
  }

  // ---- what the player does ----------------------------------------------------

  /** Leave the briefing and start playing. */
  begin(): void {
    if (this.phase !== 'brief') return
    this.events.push({ type: 'begin' })
    this.phase = 'play'
    this.settle()
  }

  /** Enter a line at the terminal. */
  run(line: string): CommandRecord {
    const record = this.shell.run(line)
    if (this.phase !== 'play') return record
    this.events.push({ type: 'command', line })
    this.records.push(record)
    this.settle()
    return record
  }

  /** Press Continue on something that was said, or to let time pass. */
  continue(): void {
    if (this.phase !== 'play') return
    const beat = this.currentBeat()
    if (!beat || !('say' in beat || 'advance' in beat)) return
    this.events.push({ type: 'continue' })
    this.continued = true
    this.settle()
  }

  /** Answer a logbook entry. Returns how it was marked. */
  answer(entryId: string, answer: Answer): Grade {
    const entry = this.loaded.level.logbook.find((e) => e.id === entryId)
    if (!entry) throw new Error(`no logbook entry "${entryId}" in ${this.loaded.level.id}`)
    const previous = this.answers.get(entryId)
    if (this.phase !== 'play' || !this.isOpen(entryId)) return previous?.grade ?? { correct: false }
    // A completed entry is settled: later edits cannot undo it.
    if (previous?.grade.correct) return previous.grade

    this.events.push({ type: 'answer', entry: entryId, answer })
    const result = grade(entry, answer)
    this.answers.set(entryId, { answer, grade: result })
    this.settle()
    return result
  }

  /** Make a move on the board puzzle. Moves that are not possible are ignored. */
  move(move: Move): void {
    if (this.phase !== 'play') return
    const beat = this.currentBeat()
    const puzzle = this.loaded.level.puzzle
    if (!beat || !('puzzle' in beat) || !puzzle) return
    const before = this.stages.get(beat.puzzle.stage)
    if (!before) return
    const after = playMove(puzzle, before, move)
    if (after === before) return
    this.events.push({ type: 'move', move })
    this.stages.set(beat.puzzle.stage, after)
    this.settle()
  }

  /** Play back one recorded event. */
  apply(event: LevelEvent): void {
    if (event.type === 'begin') this.begin()
    else if (event.type === 'command') this.run(event.line)
    else if (event.type === 'continue') this.continue()
    else if (event.type === 'move') this.move(event.move)
    else this.answer(event.entry, event.answer)
  }

  // ---- what the interface reads ------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState = (): LevelState => this.state

  /** Every line entered so far in this level, with what it did. */
  get commandRecords(): readonly CommandRecord[] {
    return this.records
  }

  // ---- progress ----------------------------------------------------------------

  private currentBeat(): Beat | null {
    return this.loaded.level.beats[this.beatIndex] ?? null
  }

  private context(from: number): PredicateContext {
    const logged = new Set<string>()
    for (const [id, { grade: g }] of this.answers) if (g.correct) logged.add(id)
    const solved = new Set<string>()
    for (const [id, play] of this.stages) if (play.solved) solved.add(id)
    return {
      solved,
      world: this.world,
      shells: this.shells,
      currentHost: this.host,
      records: this.records,
      from,
      objectives: this.met,
      logged,
    }
  }

  /** An entry opens when its `log` beat is reached, or at the start if no beat asks for it. */
  private isOpen(entryId: string): boolean {
    const index = this.loaded.level.beats.findIndex((b) => 'log' in b && b.log.entry === entryId)
    return index === -1 || index <= this.beatIndex
  }

  /** Apply a beat's one-time effects as it becomes current. */
  private enter(beat: Beat): void {
    this.entered = true
    this.beatFrom = this.records.length
    this.continued = false
    if ('deliver' in beat) {
      const item = this.loaded.tray.find((t) => t.id === beat.deliver.item)
      if (!item) throw new Error(`${this.loaded.level.id}: nothing to deliver called "${beat.deliver.item}"`)
      if (!this.delivered.includes(item)) this.delivered.push(item)
    } else if ('connect' in beat) {
      this.login(beat.connect.host, beat.connect.user ?? this.loaded.level.user)
      this.host = beat.connect.host
    } else if ('puzzle' in beat) {
      const puzzle = this.loaded.level.puzzle
      if (!puzzle) throw new Error(`${this.loaded.level.id}: a puzzle beat, but the level has no puzzle`)
      if (!this.stages.has(beat.puzzle.stage)) {
        this.stages.set(beat.puzzle.stage, startStage(puzzle, beat.puzzle.stage))
      }
      this.latestStage = beat.puzzle.stage
    }
  }

  private isDone(beat: Beat): boolean {
    if ('say' in beat) return this.continued
    if ('advance' in beat) {
      if (!this.continued) return false
      this.world.clock.advance(beat.advance.seconds)
      return true
    }
    if ('log' in beat) return this.answers.get(beat.log.entry)?.grade.correct === true
    if ('puzzle' in beat) return this.stages.get(beat.puzzle.stage)?.solved === true
    if ('prompt' in beat) {
      const done: Predicate = beat.prompt.done ?? { command_ran: programsIn(beat.prompt.run) }
      return holds(done, this.context(this.beatFrom))
    }
    return true // deliver and connect finish as soon as they have happened
  }

  /** Move through beats and objectives until nothing more changes, then tell listeners. */
  private settle(): void {
    if (this.phase === 'play') {
      let changed = true
      while (changed) {
        changed = false

        for (;;) {
          const beat = this.currentBeat()
          if (!beat) break
          if (!this.entered) this.enter(beat)
          if (!this.isDone(beat)) break
          this.beatIndex++
          this.entered = false
          changed = true
        }

        for (const objective of this.loaded.level.objectives) {
          if (this.met.has(objective.id)) continue
          if (holds(objective.when, this.context(0))) {
            this.met.set(objective.id, this.records.length)
            changed = true
          }
        }
      }

      const { beats, objectives, logbook } = this.loaded.level
      const finished =
        this.beatIndex >= beats.length &&
        objectives.every((o) => this.met.has(o.id)) &&
        logbook.every((e) => this.answers.get(e.id)?.grade.correct === true)
      if (finished) this.phase = 'debrief'
    }

    this.state = this.buildState()
    for (const listener of this.listeners) listener()
  }

  private puzzleView(): PuzzleView | null {
    const puzzle = this.loaded.level.puzzle
    const play = this.latestStage === null ? undefined : this.stages.get(this.latestStage)
    if (!puzzle || !play) return null
    const index = puzzle.stages.findIndex((s) => s.id === play.stage)
    const beat = this.phase === 'play' ? this.currentBeat() : null
    const current = beat !== null && 'puzzle' in beat && beat.puzzle.stage === play.stage
    return {
      title: puzzle.title,
      step: puzzle.step,
      stage: puzzle.stages[index]!,
      number: index + 1,
      of: puzzle.stages.length,
      play,
      moves: current ? stageMoves(puzzle, play) : [],
    }
  }

  private buildState(): LevelState {
    const { objectives, logbook } = this.loaded.level
    return {
      puzzle: this.puzzleView(),
      phase: this.phase,
      host: this.host,
      beatIndex: this.beatIndex,
      beat: this.phase === 'play' ? this.currentBeat() : null,
      attempts: this.records.length - this.beatFrom,
      objectives: objectives.map((o) => ({ id: o.id, text: o.text, met: this.met.has(o.id) })),
      logbook: logbook.map((entry) => {
        const given = this.answers.get(entry.id)
        return {
          entry,
          open: this.isOpen(entry.id),
          answer: given?.answer ?? null,
          grade: given?.grade ?? null,
          complete: given?.grade.correct === true,
        }
      }),
      tray: [...this.delivered],
      complete: this.phase === 'debrief',
    }
  }
}

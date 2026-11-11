import { buildWorld, type LoadedGame, type LoadedLevel } from '../engine/levels/loader.ts'
import { LevelSession, type LevelEvent } from '../engine/levels/runner.ts'
import type { Card } from '../engine/levels/schema.ts'
import type { ProgramRegistry } from '../engine/shell/types.ts'
import { TerminalModel } from './terminal/model.ts'

/** What is worth keeping between visits. Small on purpose: see `Game.snapshot`. */
export interface GameSnapshot {
  /** Ids of completed levels, in the order they were completed. */
  completed: string[]
  /** The level in progress, and everything the player has done in it. */
  current: { level: string; events: LevelEvent[] } | null
}

export interface GameState {
  levelIndex: number
  /** Goes up each time a level is opened or restarted, so the desk can start clean. */
  visit: number
  loaded: LoadedLevel
  session: LevelSession
  terminal: TerminalModel
  completed: readonly string[]
  /** True once the last level has been completed and left. */
  finished: boolean
}

export interface ManualPage {
  name: string
  section: string
  text: string
}

/**
 * The game as a whole: which level is in play, which are done, and the
 * terminal and level session for the current one. The React desk draws this
 * and calls back into it; nothing here touches the browser.
 */
export class Game {
  readonly content: LoadedGame
  private readonly programs: ProgramRegistry
  private readonly listeners = new Set<() => void>()
  private completed: string[] = []
  private finished = false
  private visits = 0
  private state!: GameState
  private stopWatching: (() => void) | undefined

  constructor(content: LoadedGame, programs: ProgramRegistry, snapshot?: GameSnapshot) {
    this.content = content
    this.programs = programs

    const known = new Set(content.levels.map((l) => l.level.id))
    this.completed = (snapshot?.completed ?? []).filter((id) => known.has(id))

    const savedIndex = snapshot?.current
      ? content.levels.findIndex((l) => l.level.id === snapshot.current!.level)
      : -1
    if (savedIndex >= 0) {
      this.open(savedIndex, snapshot!.current!.events)
    } else {
      // Resume at the first level not yet completed.
      const next = content.levels.findIndex((l) => !this.completed.includes(l.level.id))
      if (next === -1) {
        this.finished = true
        this.open(content.levels.length - 1, [])
      } else {
        this.open(next, [])
      }
    }
  }

  // ---- subscription ------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState = (): GameState => this.state

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  // ---- levels ------------------------------------------------------------------

  /**
   * Start a level from its canonical world, then play back any saved events.
   * Events go through the terminal, so the screen is rebuilt along with the
   * world. If playback fails (the level changed since the save), the level
   * simply starts fresh.
   */
  private open(index: number, events: readonly LevelEvent[]): void {
    const build = (): { session: LevelSession; terminal: TerminalModel } => {
      const loaded = this.content.levels[index]!
      const session = new LevelSession({
        loaded,
        world: buildWorld(this.content, index, this.programs),
        programs: this.programs,
        tty: this.content.game.tty,
      })
      const terminal = new TerminalModel(session)
      terminal.print(this.banner(session))
      return { session, terminal }
    }

    let { session, terminal } = build()
    try {
      for (const event of events) {
        const hostBefore = session.getState().host
        if (event.type === 'command') {
          terminal.setInput(event.line)
          terminal.submit()
          terminal.pagerQuit()
        } else {
          session.apply(event)
        }
        if (session.getState().host !== hostBefore) terminal.print(this.banner(session))
      }
    } catch {
      ;({ session, terminal } = build())
    }

    this.stopWatching?.()
    let host = session.getState().host
    this.stopWatching = session.subscribe(() => {
      const now = session.getState()
      if (now.host !== host) {
        host = now.host
        terminal.print(this.banner(session))
      }
      if (now.complete) this.markCompleted(session.loaded.level.id)
      this.notify()
    })

    this.state = {
      levelIndex: index,
      visit: ++this.visits,
      loaded: this.content.levels[index]!,
      session,
      terminal,
      completed: this.completed,
      finished: this.finished,
    }
    if (session.getState().complete) this.markCompleted(session.loaded.level.id)
  }

  /** What the terminal shows on logging in: the host's name and its message of the day. */
  private banner(session: LevelSession): string {
    const host = session.shell.host
    const motd = host.fs.peek('/etc/motd') ?? ''
    return `Connected to ${host.name}.\n${motd}`
  }

  private markCompleted(id: string): void {
    if (this.completed.includes(id)) return
    this.completed = [...this.completed, id]
    if (this.state) this.state = { ...this.state, completed: this.completed }
  }

  get hasNextLevel(): boolean {
    return this.state.levelIndex + 1 < this.content.levels.length
  }

  /** Leave a completed level for the next one, or for the end screen after the last. */
  next(): void {
    if (!this.state.session.getState().complete) return
    if (this.hasNextLevel) {
      this.open(this.state.levelIndex + 1, [])
    } else {
      this.finished = true
      this.state = { ...this.state, finished: true }
    }
    this.notify()
  }

  /** Start the current level again from its beginning. */
  restartLevel(): void {
    this.open(this.state.levelIndex, [])
    this.notify()
  }

  /** Go to any level that has been reached: for replaying earlier levels. */
  goToLevel(index: number): void {
    const reachable = index >= 0 && index <= this.completed.length && index < this.content.levels.length
    if (!reachable) return
    this.finished = false
    this.open(index, [])
    this.notify()
  }

  /** Forget everything and start from Level 1. */
  reset(): void {
    this.completed = []
    this.finished = false
    this.open(0, [])
    this.notify()
  }

  // ---- what the binder shows -----------------------------------------------------

  /** Debrief cards earned so far, in level order. */
  get cards(): { level: LoadedLevel; card: Card }[] {
    return this.content.levels
      .filter((l) => this.completed.includes(l.level.id))
      .map((level) => ({ level, card: level.card }))
  }

  /** The manual pages installed on the host the player is on. */
  manualPages(): ManualPage[] {
    const fs = this.state.session.shell.host.fs
    const pages: ManualPage[] = []
    for (const dir of fs.entries('/usr/man') ?? []) {
      const section = /^man(\d)$/.exec(dir)?.[1]
      if (section === undefined) continue
      for (const file of fs.entries(`/usr/man/${dir}`) ?? []) {
        const text = fs.peek(`/usr/man/${dir}/${file}`)
        if (text === undefined) continue
        pages.push({ name: file.replace(/\.\d$/, ''), section, text })
      }
    }
    return pages.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  }

  // ---- saving ------------------------------------------------------------------

  /**
   * Progress as plain data. Completed levels are just their ids; the level in
   * progress is the list of everything the player has done in it, which is
   * enough to rebuild it exactly because the engine is deterministic.
   */
  snapshot(): GameSnapshot {
    const { session, loaded } = this.state
    const inProgress = !this.finished && !session.getState().complete
    return {
      completed: [...this.completed],
      current:
        inProgress && session.events.length > 0
          ? { level: loaded.level.id, events: [...session.events] }
          : null,
    }
  }
}

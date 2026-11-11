import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import type { Answer, Grade } from '../engine/levels/logbook.ts'
import type { TrayItem } from '../engine/levels/schema.ts'
import { formatDate } from '../engine/world/time.ts'
import { Binder } from './Binder.tsx'
import type { Game, GameState } from './game.ts'
import { Guidance } from './Guidance.tsx'
import { Logbook } from './Logbook.tsx'
import { Briefing, Debrief, Finished } from './Screens.tsx'
import { Terminal } from './terminal/Terminal.tsx'
import type { TermLine } from './terminal/model.ts'
import { Tray } from './Tray.tsx'

type Tab = 'logbook' | 'tray' | 'binder'

const TABS: { id: Tab; label: string }[] = [
  { id: 'logbook', label: 'Logbook' },
  { id: 'tray', label: 'Printout tray' },
  { id: 'binder', label: 'Binder' },
]

/** One level at the desk. Remounted for each new level, so its state starts clean. */
function LevelDesk({ game, gameState }: { game: Game; gameState: GameState }) {
  const { session, terminal, loaded } = gameState
  const level = useSyncExternalStore(session.subscribe, session.getState)
  const [tab, setTab] = useState<Tab>('logbook')
  /** The logbook entry a line is being chosen for, if any. */
  const [picking, setPicking] = useState<string | null>(null)
  /** How many tray items the player has had the chance to see. */
  const [seenTray, setSeenTray] = useState(0)
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({})

  const focusTerminal = (): void => document.getElementById('terminal-input')?.focus()

  function showTab(next: Tab, focus = false): void {
    setTab(next)
    if (next === 'tray') setSeenTray(level.tray.length)
    if (focus) tabRefs.current[next]?.focus()
  }

  // Follow the level: put focus where the next thing to do is.
  const beat = level.beat
  const beatKind = beat ? Object.keys(beat)[0] : 'none'
  const logEntry = beat && 'log' in beat ? beat.log.entry : null

  // When the level reaches a logbook entry, bring the logbook to the front.
  const [followedBeat, setFollowedBeat] = useState(-1)
  if (level.phase === 'play' && followedBeat !== level.beatIndex) {
    setFollowedBeat(level.beatIndex)
    if (logEntry !== null) setTab('logbook')
  }

  useEffect(() => {
    if (level.phase !== 'play') return
    if (beatKind === 'say' || beatKind === 'advance') {
      document.getElementById('guidance-continue')?.focus()
    } else if (beatKind === 'prompt') {
      document.getElementById('terminal-input')?.focus()
    } else if (beatKind === 'none') {
      // The script has run out: what remains is in the logbook.
      document.getElementById('guidance-logbook')?.focus()
    } else if (logEntry !== null) {
      // Wait for the logbook to be on screen before focusing into it.
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`#entry-${logEntry} input, #entry-${logEntry} button`)?.focus()
      })
    }
    // Keyed on the beat alone: this must not run on every command.
  }, [level.beatIndex, level.phase, beatKind, logEntry])

  // Evidence already pinned, so the terminal and tray can mark those lines.
  const pinned = useMemo(() => {
    const texts = new Set<string>()
    for (const entry of level.logbook) {
      if (entry.complete && entry.answer?.kind === 'pin') texts.add(entry.answer.text)
    }
    return texts
  }, [level.logbook])

  function endPick(entryId: string): void {
    setPicking(null)
    setTab('logbook')
    requestAnimationFrame(() => document.getElementById(`entry-${entryId}-pin`)?.focus())
  }

  function pick(text: string, source: string): void {
    if (picking === null) return
    session.answer(picking, { kind: 'pin', text, source })
    endPick(picking)
  }

  // Alt-1 to Alt-4 jump between the parts of the desk.
  function onDeskKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (!event.altKey || event.ctrlKey || event.metaKey) return
    const target = { Digit1: 'terminal', Digit2: 'logbook', Digit3: 'tray', Digit4: 'binder' }[event.code]
    if (target === undefined) return
    event.preventDefault()
    if (target === 'terminal') focusTerminal()
    else showTab(target as Tab, true)
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    const index = TABS.findIndex((t) => t.id === tab)
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length
    else if (event.key === 'ArrowLeft') next = (index + TABS.length - 1) % TABS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = TABS.length - 1
    else return
    event.preventDefault()
    showTab(TABS[next]!.id, true)
  }

  if (gameState.finished) {
    return <Finished content={game.content} onReview={() => game.goToLevel(gameState.levelIndex)} />
  }
  if (level.phase === 'brief') {
    return <Briefing loaded={loaded} onBegin={() => session.begin()} />
  }
  if (level.phase === 'debrief') {
    return <Debrief loaded={loaded} hasNext={game.hasNextLevel} onNext={() => game.next()} />
  }

  const shell = session.shell
  const unseen = level.tray.length - seenTray

  return (
    <div className="desk-play" onKeyDown={onDeskKeyDown}>
      <div className="desk-left">
        <Guidance
          level={level}
          beats={loaded.level.beats}
          onContinue={() => session.continue()}
          onOpenLogbook={() => showTab('logbook', true)}
        />
        <div className="desk-terminal">
          <Terminal
            model={terminal}
            pinned={pinned}
            picking={picking !== null}
            onPick={(line: TermLine) => pick(line.text, 'terminal')}
            onCancelPick={() => picking !== null && endPick(picking)}
            onLeave={() => tabRefs.current[tab]?.focus()}
          />
        </div>
        <p className="status-line">
          <span>
            <span className="visually-hidden">You are </span>
            {shell.user}@{shell.host.name}:{shell.cwd}
          </span>
          <span>{formatDate(shell.host.clock.now, shell.host.timezone)}</span>
        </p>
      </div>

      <div className="desk-right">
        <div className="tabs" role="tablist" aria-label="Desk">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              className="tab"
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              ref={(element) => {
                tabRefs.current[t.id] = element
              }}
              onClick={() => showTab(t.id)}
              onKeyDown={onTabKeyDown}
            >
              {t.label}
              {t.id === 'tray' && unseen > 0 && tab !== 'tray' && <span className="tab-badge"> · new</span>}
            </button>
          ))}
        </div>
        <div className="panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'logbook' && (
            <Logbook
              level={level}
              onAnswer={(entryId: string, answer: Answer): Grade => session.answer(entryId, answer)}
              onStartPick={(entryId) => setPicking(picking === entryId ? null : entryId)}
              pickingEntry={picking}
            />
          )}
          {tab === 'tray' && (
            <Tray
              items={level.tray}
              picking={picking !== null}
              onPick={(item: TrayItem, text: string) => pick(text, `printout:${item.id}`)}
              onCancelPick={() => picking !== null && endPick(picking)}
              pinned={pinned}
            />
          )}
          {tab === 'binder' && <Binder game={game} loaded={loaded} level={level} />}
        </div>
      </div>
    </div>
  )
}

/** The whole desk: a header, then the current level. */
export function Desk({ game }: { game: Game }) {
  const gameState = useSyncExternalStore(game.subscribe, game.getState)
  const { loaded } = gameState
  return (
    <main className="desk">
      <header className="desk-header">
        <h1>{game.content.game.title}</h1>
        <p className="desk-level">
          Level {loaded.level.number} of {game.content.levels.length}: {loaded.level.title}
        </p>
      </header>
      <LevelDesk key={gameState.visit} game={game} gameState={gameState} />
    </main>
  )
}

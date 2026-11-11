import { useState } from 'react'
import type { LoadedLevel } from '../engine/levels/loader.ts'
import type { LevelState } from '../engine/levels/runner.ts'
import { CardView } from './CardView.tsx'
import type { Game } from './game.ts'
import { RichText } from './RichText.tsx'

type Section = 'level' | 'manual' | 'cards' | 'help'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'level', label: 'This level' },
  { id: 'manual', label: 'Manual' },
  { id: 'cards', label: 'Cards' },
  { id: 'help', label: 'Desk help' },
]

export interface BinderProps {
  game: Game
  loaded: LoadedLevel
  level: LevelState
}

/** A button that asks once more before doing something that cannot be undone. */
function ConfirmButton({ label, confirm, onConfirm }: { label: string; confirm: string; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return (
      <button type="button" className="button button-quiet" onClick={() => setAsking(true)}>
        {label}
      </button>
    )
  }
  return (
    <span className="confirm" role="group" aria-label={confirm}>
      {confirm}{' '}
      <button type="button" className="button" onClick={onConfirm}>
        Yes
      </button>{' '}
      <button type="button" className="button button-quiet" onClick={() => setAsking(false)}>
        No
      </button>
    </span>
  )
}

/** The briefing again, plus everything said and every command introduced so far. */
function LevelNotes({ loaded, level }: { loaded: LoadedLevel; level: LevelState }) {
  const past = loaded.level.beats.slice(0, level.beatIndex)
  return (
    <div>
      <h4>Briefing</h4>
      <RichText text={loaded.level.brief} />
      <h4>So far</h4>
      {past.length === 0 && <p className="binder-empty">Nothing yet. Steps you finish are kept here.</p>}
      <ol className="notes">
        {past.map((beat, i) => {
          if ('say' in beat) {
            return (
              <li key={i}>
                <strong>{beat.say.who}:</strong> <RichText text={beat.say.text} />
              </li>
            )
          }
          if ('prompt' in beat) {
            return (
              <li key={i}>
                <RichText text={beat.prompt.goal} />
                <pre className="notes-command">
                  <code>{beat.prompt.run}</code>
                </pre>
                <RichText text={beat.prompt.explain} />
                {beat.prompt.result !== undefined && (
                  <>
                    <p>
                      <strong>What the output meant:</strong>
                    </p>
                    <RichText text={beat.prompt.result} />
                  </>
                )}
              </li>
            )
          }
          if ('advance' in beat) {
            return (
              <li key={i}>
                <RichText text={beat.advance.text} />
              </li>
            )
          }
          return null
        })}
      </ol>
    </div>
  )
}

function Manual({ game }: { game: Game }) {
  const pages = game.manualPages()
  const [name, setName] = useState<string | null>(null)
  const page = pages.find((p) => p.name === name)

  if (pages.length === 0) return <p className="binder-empty">This system has no manual pages installed.</p>
  if (page) {
    return (
      <div>
        <button type="button" className="link-button" onClick={() => setName(null)}>
          ← All manual pages
        </button>
        <pre className="manual-page" tabIndex={0} aria-label={`Manual page for ${page.name}`}>
          {page.text}
        </pre>
      </div>
    )
  }
  return (
    <div>
      <p>
        The same pages the <code>man</code> command prints. Pick one to read it here.
      </p>
      <ul className="manual-list">
        {pages.map((p) => (
          <li key={`${p.name}.${p.section}`}>
            <button type="button" className="link-button" onClick={() => setName(p.name)}>
              {p.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Cards({ game }: { game: Game }) {
  const cards = game.cards
  if (cards.length === 0) {
    return <p className="binder-empty">No cards yet. Each level you finish leaves one here.</p>
  }
  return (
    <div className="card-stack">
      {cards.map(({ level, card }) => (
        <CardView key={card.id} card={card} levelNumber={level.level.number} />
      ))}
    </div>
  )
}

function Help({ game }: { game: Game }) {
  const { content } = game
  const reached = game.getState().completed.length
  return (
    <div>
      <h4>The terminal</h4>
      <ul>
        <li>Type a command and press Enter to run it.</li>
        <li>Up and Down arrows bring back commands you typed before.</li>
        <li>Tab finishes a command or file name you have started typing.</li>
        <li>Ctrl-C abandons the line you are typing. Ctrl-L clears the screen.</li>
        <li>
          When a long file pauses at <code>--More--</code>: Space shows the next page, Enter one more line, q stops.
        </li>
        <li>
          <code>help</code> lists every command. <code>man</code> and a command name explains one.
        </li>
      </ul>
      <h4>Getting around</h4>
      <ul>
        <li>Escape moves from the terminal to the logbook, tray and binder tabs.</li>
        <li>Alt-1 goes to the terminal, Alt-2 the logbook, Alt-3 the tray, Alt-4 the binder.</li>
        <li>Left and Right arrows switch between tabs.</li>
      </ul>
      <h4>Evidence</h4>
      <ul>
        <li>
          Some logbook entries ask you to pin a line. Press the Pin button, then click the line in the terminal or
          on a printout that proves the point. With the keyboard: arrows move, Enter pins, Escape cancels.
        </li>
        <li>Nothing is scored or timed. A wrong answer only means: look again.</li>
      </ul>
      <h4>Your progress</h4>
      <ul>
        <li>
          Everything you do is saved in this browser as you go. Close the page whenever you like and come back to
          the same place. Nothing is sent anywhere.
        </li>
      </ul>
      <h4>Levels</h4>
      <ul className="level-list">
        {content.levels.map((l, index) => (
          <li key={l.level.id}>
            {index <= reached ? (
              <ConfirmButton
                label={`Level ${l.level.number}: ${l.level.title}`}
                confirm={`Start Level ${l.level.number} from its beginning?`}
                onConfirm={() => game.goToLevel(index)}
              />
            ) : (
              <span className="level-locked">Level {l.level.number}: not reached yet</span>
            )}
          </li>
        ))}
      </ul>
      <p>
        <ConfirmButton
          label="Erase all progress"
          confirm="Erase everything and start from Level 1?"
          onConfirm={() => game.reset()}
        />
      </p>
      {content.game.credits && (
        <p className="credits">
          {content.game.credits.text}{' '}
          <a href={content.game.credits.url} target="_blank" rel="noreferrer">
            Read the public paper.
          </a>
        </p>
      )}
    </div>
  )
}

/** The binder: notes on this level, manual pages, debrief cards and help. */
export function Binder({ game, loaded, level }: BinderProps) {
  const [section, setSection] = useState<Section>('level')
  return (
    <div className="binder">
      <nav aria-label="Binder sections">
        <ul className="binder-nav">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="binder-nav-button"
                aria-current={section === s.id ? 'page' : undefined}
                onClick={() => setSection(s.id)}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="binder-page">
        {section === 'level' && <LevelNotes loaded={loaded} level={level} />}
        {section === 'manual' && <Manual game={game} />}
        {section === 'cards' && <Cards game={game} />}
        {section === 'help' && <Help game={game} />}
      </div>
    </div>
  )
}

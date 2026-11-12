import { useLayoutEffect, useRef, useState } from 'react'
import type { LevelState } from '../engine/levels/runner.ts'
import type { Beat, GuidanceMode } from '../engine/levels/schema.ts'
import { InlineText, RichText } from './RichText.tsx'

export interface GuidanceProps {
  level: LevelState
  /** Every beat of the level, so the last finished step can be recalled. */
  beats: readonly Beat[]
  /** How much help the level gives: every command, or a goal with hints on request. */
  mode: GuidanceMode
  onContinue: () => void
  onOpenLogbook: () => void
  /** Put the keyboard back on the terminal, or on the board while a puzzle is on it. */
  onReturn: () => void
}

/** The most recent command step the player has finished, if it explains its output. */
function lastResult(beats: readonly Beat[], beatIndex: number): { run: string; result: string } | null {
  for (let i = Math.min(beatIndex, beats.length) - 1; i >= 0; i--) {
    const beat = beats[i]!
    // A puzzle in between is a change of subject: the old command is no longer on the screen.
    if ('puzzle' in beat) return null
    if ('prompt' in beat) {
      return beat.prompt.result === undefined ? null : { run: beat.prompt.run, result: beat.prompt.result }
    }
  }
  return null
}

/**
 * What the output of the last command means. It stays at the top of the
 * guidance until the next command is done, so the player can read it while
 * the output is still on the screen below.
 */
function Recap({ run, result, guided }: { run: string; result: string; guided: boolean }) {
  return (
    <section className="guidance-recap" aria-label="What your last command showed">
      {/* Outside a guided level the player chose the command, so it is not quoted back. */}
      {guided && (
        <>
          <p className="guidance-label">You ran:</p>
          <pre className="guidance-recap-command">
            <code>{run}</code>
          </pre>
        </>
      )}
      <p className="guidance-label">{guided ? 'What the output means:' : 'What you just found:'}</p>
      <RichText text={result} />
    </section>
  )
}

/**
 * The hint ladder of a scaffolded step: a nudge, then how the command works,
 * then the command itself. Each is shown only when asked for, and all are free.
 */
function Ladder({
  nudge,
  approach,
  command,
  onLast,
}: {
  nudge: string | undefined
  approach: string
  command: string
  /** The last hint has been asked for, and its button is about to go. */
  onLast: () => void
}) {
  const [shown, setShown] = useState(0)
  const rungs = [
    ...(nudge === undefined ? [] : [{ label: 'A nudge', text: nudge }]),
    { label: 'How to do it', text: approach },
  ]
  const total = rungs.length + 1
  return (
    <div className="guidance-hints">
      {shown > 0 && (
        <ol className="guidance-hint-list" role="status">
          {rungs.slice(0, shown).map((rung) => (
            <li key={rung.label}>
              <strong>{rung.label}.</strong> <InlineText text={rung.text} />
            </li>
          ))}
          {shown === total && (
            <li>
              <strong id="guidance-command-label">The command.</strong>
              <pre className="guidance-command" aria-labelledby="guidance-command-label">
                <code>{command}</code>
              </pre>
            </li>
          )}
        </ol>
      )}
      {shown < total && (
        <button
          type="button"
          className="button button-quiet"
          onClick={() => {
            setShown(shown + 1)
            // The command is the last hint: what comes next is typing it.
            if (shown + 1 === total) onLast()
          }}
        >
          {shown === 0
            ? 'Give me a hint'
            : shown === total - 1
              ? `Show me the command (hint ${total} of ${total})`
              : `Another hint (${shown} of ${total} shown)`}
        </button>
      )}
    </div>
  )
}

/** Free hints for a puzzle stage, shown one at a time, gentlest first. */
function Hints({ hints, onLast }: { hints: readonly string[]; onLast: () => void }) {
  const [shown, setShown] = useState(0)
  if (hints.length === 0) return null
  return (
    <div className="guidance-hints">
      {shown > 0 && (
        <ol className="guidance-hint-list" role="status">
          {hints.slice(0, shown).map((hint, i) => (
            <li key={i}>
              <InlineText text={hint} />
            </li>
          ))}
        </ol>
      )}
      {shown < hints.length && (
        <button
          type="button"
          className="button button-quiet"
          onClick={() => {
            setShown(shown + 1)
            // The button goes with the last hint. Do not leave the keyboard nowhere.
            if (shown + 1 === hints.length) onLast()
          }}
        >
          {shown === 0 ? 'Give me a hint' : `Another hint (${shown} of ${hints.length} shown)`}
        </button>
      )}
    </div>
  )
}

/**
 * The mentor's voice, just above the terminal. In a guided level it shows the
 * current beat: something said, a command to type with what it does, a
 * logbook entry to fill in, or a wait. Above it, what the last command's
 * output means.
 */
export function Guidance({ level, beats, mode, onContinue, onOpenLogbook, onReturn }: GuidanceProps) {
  const guided = mode === 'guided'
  const beat = level.beat
  const recap = lastResult(beats, level.beatIndex)

  // Each new step starts at the top, never part-way down the last one.
  const box = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    box.current?.scrollTo?.({ top: 0 })
  }, [level.beatIndex])

  let body
  if (!beat) {
    const goals = level.objectives.filter((o) => !o.met)
    const entries = level.logbook.filter((e) => !e.complete)
    body = (
      <>
        <h2 className="guidance-heading">To finish this level</h2>
        {goals.length > 0 && (
          <ul>
            {goals.map((goal) => (
              <li key={goal.id}>{goal.text}</li>
            ))}
          </ul>
        )}
        {entries.length > 0 && (
          <p>
            Complete your logbook: {entries.length === 1 ? 'one entry is' : `${entries.length} entries are`} still
            open.{' '}
            <button type="button" id="guidance-logbook" className="link-button" onClick={onOpenLogbook}>
              Go to the logbook
            </button>
          </p>
        )}
      </>
    )
  } else if ('say' in beat) {
    body = (
      <>
        <h2 className="guidance-heading">{beat.say.who}</h2>
        <RichText text={beat.say.text} />
        <button type="button" id="guidance-continue" className="button" onClick={onContinue}>
          Continue
        </button>
      </>
    )
  } else if ('advance' in beat) {
    body = (
      <>
        <h2 className="guidance-heading">Waiting</h2>
        <RichText text={beat.advance.text} />
        <button type="button" id="guidance-continue" className="button" onClick={onContinue}>
          Wait
        </button>
      </>
    )
  } else if ('prompt' in beat && !guided) {
    body = (
      <>
        <h2 className="guidance-heading">{beat.prompt.who ?? 'Next step'}</h2>
        <RichText text={beat.prompt.goal} />
        <p className="guidance-label">
          Work out the command and type it in the terminal. Any command that finds the answer will do. Hints are
          free.
        </p>
        <Ladder
          key={level.beatIndex}
          nudge={beat.prompt.nudge}
          approach={beat.prompt.explain}
          command={beat.prompt.run}
          onLast={onReturn}
        />
      </>
    )
  } else if ('prompt' in beat) {
    body = (
      <>
        <h2 className="guidance-heading">{beat.prompt.who ?? 'Next step'}</h2>
        <RichText text={beat.prompt.goal} />
        <p className="guidance-label" id="guidance-command-label">
          Type this in the terminal, then press Enter:
        </p>
        <pre className="guidance-command" aria-labelledby="guidance-command-label">
          <code>{beat.prompt.run}</code>
        </pre>
        <p className="guidance-label">What it does:</p>
        <RichText text={beat.prompt.explain} />
        {level.attempts >= 2 && (
          <p className="guidance-nudge" role="status">
            Not there yet. Compare your line with the one above, character by character. The up arrow brings
            your last line back so you can fix it instead of retyping.
          </p>
        )}
      </>
    )
  } else if ('puzzle' in beat && level.puzzle) {
    const { stage, step, number, of } = level.puzzle
    body = (
      <>
        <h2 className="guidance-heading">{beat.puzzle.who ?? 'The puzzle'}</h2>
        <p className="guidance-label">
          {step} {number} of {of}: {stage.title}
        </p>
        <RichText text={stage.goal} />
        {number === 1 && (
          <p>
            Play with the buttons on the board below. Nothing is scored: a move that fails only shows you a rule.
          </p>
        )}
        <Hints key={stage.id} hints={stage.hints} onLast={onReturn} />
      </>
    )
  } else if ('log' in beat) {
    body = (
      <>
        <h2 className="guidance-heading">{beat.log.who ?? 'Write it down'}</h2>
        <RichText text={beat.log.text ?? 'Record what you found in your logbook before going on.'} />
        <button type="button" className="button" onClick={onOpenLogbook}>
          Go to the logbook
        </button>
      </>
    )
  }

  return (
    <section
      ref={box}
      className={recap ? 'guidance guidance-has-recap' : 'guidance'}
      aria-label="Guidance"
      aria-live="polite"
    >
      {recap && <Recap run={recap.run} result={recap.result} guided={guided} />}
      <div className="guidance-now">{body}</div>
    </section>
  )
}

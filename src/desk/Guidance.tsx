import type { LevelState } from '../engine/levels/runner.ts'
import { RichText } from './RichText.tsx'

export interface GuidanceProps {
  level: LevelState
  onContinue: () => void
  onOpenLogbook: () => void
}

/**
 * The mentor's voice, just above the terminal. In a guided level it shows the
 * current beat: something said, a command to type with what it means, a
 * logbook entry to fill in, or a wait.
 */
export function Guidance({ level, onContinue, onOpenLogbook }: GuidanceProps) {
  const beat = level.beat

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
        <RichText text={beat.prompt.explain} />
        {level.attempts >= 2 && (
          <p className="guidance-nudge" role="status">
            Not there yet. Compare your line with the one above, character by character. The up arrow brings
            your last line back so you can fix it instead of retyping.
          </p>
        )}
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
    <section className="guidance" aria-label="Guidance" aria-live="polite">
      {body}
    </section>
  )
}

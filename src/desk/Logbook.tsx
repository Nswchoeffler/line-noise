import { useState, type FormEvent } from 'react'
import type { Answer, Grade } from '../engine/levels/logbook.ts'
import type { LevelState, LogbookEntryState } from '../engine/levels/runner.ts'
import type { LogbookEntry } from '../engine/levels/schema.ts'

export interface LogbookProps {
  level: LevelState
  onAnswer: (entryId: string, answer: Answer) => Grade
  /** Start choosing a line to pin for this entry. */
  onStartPick: (entryId: string) => void
  /** The entry a line is being chosen for, if any. */
  pickingEntry: string | null
}

type EntryOf<K extends string> = Extract<LogbookEntry, Record<K, unknown>>

interface EntryProps<K extends string> {
  state: LogbookEntryState & { entry: EntryOf<K> }
  onAnswer: (answer: Answer) => Grade
}

function Mark({ ok }: { ok: boolean }) {
  return (
    <span className={ok ? 'mark mark-ok' : 'mark mark-no'}>
      {ok ? '✓' : '✗'}
      <span className="visually-hidden">{ok ? ' correct' : ' not right yet'}</span>
    </span>
  )
}

function Feedback({ grade }: { grade: Grade | null }) {
  if (!grade || grade.correct) return null
  return (
    <p className="entry-feedback" role="status">
      Not right yet. {grade.hint ?? 'Look again and try once more.'}
    </p>
  )
}

/** A sentence with blanks to fill in. */
function FillEntry({ state, onAnswer }: EntryProps<'fill'>) {
  const { entry, answer, grade, complete } = state
  const saved = answer?.kind === 'fill' ? answer.values : {}
  const [values, setValues] = useState<Record<string, string>>(saved)

  // The sentence split into plain text and {blank} names.
  const parts = entry.fill.split(/(\{[a-z0-9_]+\})/)
  const blankNames = [...entry.fill.matchAll(/\{([a-z0-9_]+)\}/g)].map((m) => m[1]!)

  function submit(event: FormEvent): void {
    event.preventDefault()
    onAnswer({ kind: 'fill', values })
  }

  return (
    <form onSubmit={submit}>
      <p className="entry-sentence">
        {parts.map((part, i) => {
          const name = /^\{([a-z0-9_]+)\}$/.exec(part)?.[1]
          if (name === undefined) return <span key={i}>{part}</span>
          const blankNumber = blankNames.indexOf(name) + 1
          const blank = entry.blanks[name]!
          if (complete) return <strong key={i} className="entry-filled">{saved[name]}</strong>
          // A mark is shown only while the box still holds the answer that was marked.
          const marked = grade?.blanks && saved[name] !== undefined && saved[name] === values[name]
          const ok = grade?.blanks?.[name] === true
          return (
            <span key={i} className="entry-blank">
              <input
                type="text"
                value={values[name] ?? ''}
                size={blank.width}
                onChange={(e) => setValues({ ...values, [name]: e.target.value })}
                aria-label={`Blank ${blankNumber}`}
                aria-invalid={marked && !ok ? true : undefined}
                autoComplete="off"
                spellCheck={false}
              />
              {marked && (values[name] ?? '').trim() !== '' && <Mark ok={ok} />}
            </span>
          )
        })}
      </p>
      {!complete && (
        <>
          <button type="submit" className="button">
            Check
          </button>
          <Feedback grade={grade} />
        </>
      )}
    </form>
  )
}

/** Pick some of a list. */
function ChooseEntry({ state, onAnswer }: EntryProps<'choose'>) {
  const { entry, answer, grade, complete } = state
  const [chosen, setChosen] = useState<string[]>(answer?.kind === 'choose' ? answer.chosen : [])
  const single = entry.choose === 1

  function toggle(id: string): void {
    if (single) setChosen([id])
    else setChosen(chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id])
  }

  function submit(event: FormEvent): void {
    event.preventDefault()
    onAnswer({ kind: 'choose', chosen })
  }

  return (
    <form onSubmit={submit}>
      <fieldset className="entry-options" disabled={complete}>
        <legend>
          {entry.ask} <span className="entry-count">(Choose {entry.choose}.)</span>
        </legend>
        {entry.options.map((option) => (
          <label key={option.id} className="entry-option">
            <input
              type={single ? 'radio' : 'checkbox'}
              name={entry.id}
              checked={chosen.includes(option.id)}
              onChange={() => toggle(option.id)}
            />
            <span>{option.text}</span>
          </label>
        ))}
      </fieldset>
      {!complete && (
        <>
          <button type="submit" className="button" disabled={chosen.length !== entry.choose}>
            Check
          </button>
          {chosen.length !== entry.choose && (
            <span className="entry-count">
              {' '}
              {chosen.length} of {entry.choose} chosen
            </span>
          )}
          <Feedback grade={grade} />
        </>
      )}
    </form>
  )
}

/** Pin a line from the terminal or a printout. */
function PinEntry({
  state,
  onStartPick,
  picking,
}: {
  state: LogbookEntryState & { entry: EntryOf<'pin'> }
  onStartPick: () => void
  picking: boolean
}) {
  const { entry, answer, grade, complete } = state
  const pinned = answer?.kind === 'pin' ? answer.text : null
  return (
    <div>
      <p>{entry.ask}</p>
      {pinned !== null && (
        <pre className={`entry-evidence${complete ? '' : ' entry-evidence-wrong'}`}>
          <code>{pinned}</code>
        </pre>
      )}
      {!complete && (
        <>
          <button
            type="button"
            className="button"
            id={`entry-${entry.id}-pin`}
            onClick={onStartPick}
            aria-pressed={picking}
          >
            {picking ? 'Choosing a line…' : pinned === null ? 'Pin a line' : 'Pin a different line'}
          </button>
          {!picking && <Feedback grade={grade} />}
        </>
      )}
    </div>
  )
}

/** Write a sentence. */
function WriteEntry({ state, onAnswer }: EntryProps<'write'>) {
  const { entry, answer, grade, complete } = state
  const [text, setText] = useState(answer?.kind === 'write' ? answer.text : '')

  function submit(event: FormEvent): void {
    event.preventDefault()
    onAnswer({ kind: 'write', text })
  }

  if (complete) {
    return (
      <div>
        <p>{entry.ask}</p>
        <p className="entry-written">{text}</p>
      </div>
    )
  }
  return (
    <form onSubmit={submit}>
      <label className="entry-write">
        <span>{entry.ask}</span>
        <textarea value={text} rows={3} onChange={(e) => setText(e.target.value)} />
      </label>
      <button type="submit" className="button" disabled={text.trim() === ''}>
        Check
      </button>
      <Feedback grade={grade} />
    </form>
  )
}

/**
 * The logbook: the level's goals, then its entries. Completing every entry is
 * what clears the level.
 */
export function Logbook({ level, onAnswer, onStartPick, pickingEntry }: LogbookProps) {
  const open = level.logbook.filter((e) => e.open)
  const upcoming = level.logbook.length - open.length

  return (
    <div className="logbook">
      {level.objectives.length > 0 && (
        <section aria-labelledby="goals-heading">
          <h3 id="goals-heading">Goals</h3>
          <ul className="goals">
            {level.objectives.map((goal) => (
              <li key={goal.id} className={goal.met ? 'goal goal-met' : 'goal'}>
                <span className="goal-box" aria-hidden="true">
                  {goal.met ? '✓' : ''}
                </span>
                <span>{goal.text}</span>
                <span className="visually-hidden">{goal.met ? ' (done)' : ' (to do)'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="entries-heading">
        <h3 id="entries-heading">Entries</h3>
        {open.length === 0 && <p className="logbook-empty">Nothing to write down yet.</p>}
        <ol className="entries">
          {open.map((state) => {
            const { entry } = state
            const answer = (a: Answer): Grade => onAnswer(entry.id, a)
            return (
              <li
                key={entry.id}
                id={`entry-${entry.id}`}
                className={state.complete ? 'entry entry-complete' : 'entry'}
              >
                {'fill' in entry && <FillEntry state={{ ...state, entry }} onAnswer={answer} />}
                {'choose' in entry && <ChooseEntry state={{ ...state, entry }} onAnswer={answer} />}
                {'pin' in entry && (
                  <PinEntry
                    state={{ ...state, entry }}
                    onStartPick={() => onStartPick(entry.id)}
                    picking={pickingEntry === entry.id}
                  />
                )}
                {'write' in entry && <WriteEntry state={{ ...state, entry }} onAnswer={answer} />}
                {state.complete && (
                  <p className="entry-logged">
                    <Mark ok /> Logged
                  </p>
                )}
              </li>
            )
          })}
        </ol>
        {upcoming > 0 && (
          <p className="logbook-empty">
            {upcoming === 1 ? 'One more entry comes' : `${upcoming} more entries come`} later in this level.
          </p>
        )}
      </section>
    </div>
  )
}

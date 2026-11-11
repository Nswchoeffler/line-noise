import { useEffect, useRef } from 'react'
import type { LoadedGame, LoadedLevel } from '../engine/levels/loader.ts'
import { CardView } from './CardView.tsx'
import { RichText } from './RichText.tsx'

/** Put keyboard focus on a screen's main button when it appears. */
function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  return ref
}

/** Before a level: the situation, and a button to start. */
export function Briefing({ loaded, onBegin }: { loaded: LoadedLevel; onBegin: () => void }) {
  const button = useFocusOnMount<HTMLButtonElement>()
  const { level } = loaded
  return (
    <section className="screen" aria-labelledby="briefing-title">
      <p className="screen-kicker">Level {level.number}</p>
      <h2 id="briefing-title">{level.title}</h2>
      <RichText text={level.brief} />
      <button type="button" className="button button-large" ref={button} onClick={onBegin}>
        Begin
      </button>
    </section>
  )
}

/** After a level: its debrief card, and the way onward. */
export function Debrief({
  loaded,
  hasNext,
  onNext,
}: {
  loaded: LoadedLevel
  hasNext: boolean
  onNext: () => void
}) {
  const button = useFocusOnMount<HTMLButtonElement>()
  return (
    <section className="screen" aria-labelledby="debrief-title">
      <p className="screen-kicker">Level {loaded.level.number} complete</p>
      <h2 id="debrief-title">{loaded.level.title}</h2>
      <CardView card={loaded.card} levelNumber={loaded.level.number} />
      <p>This card is now in your binder.</p>
      <button type="button" className="button button-large" ref={button} onClick={onNext}>
        {hasNext ? 'Next level' : 'Finish'}
      </button>
    </section>
  )
}

/** After the last level. */
export function Finished({ content, onReview }: { content: LoadedGame; onReview: () => void }) {
  const button = useFocusOnMount<HTMLButtonElement>()
  return (
    <section className="screen" aria-labelledby="finished-title">
      <p className="screen-kicker">{content.game.title}</p>
      <h2 id="finished-title">That is every level so far</h2>
      <p>
        You have finished all {content.levels.length} levels in this version. Your debrief cards stay in the
        binder, and any level can be played again from there.
      </p>
      {content.game.credits && (
        <p className="credits">
          {content.game.credits.text}{' '}
          <a href={content.game.credits.url} target="_blank" rel="noreferrer">
            Read the public paper.
          </a>
        </p>
      )}
      <button type="button" className="button button-large" ref={button} onClick={onReview}>
        Back to the desk
      </button>
    </section>
  )
}

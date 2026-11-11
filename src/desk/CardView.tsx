import type { Card } from '../engine/levels/schema.ts'
import { RichText } from './RichText.tsx'

/** A debrief card: the idea, what it looks like today, and one sourced note from history. */
export function CardView({ card, levelNumber }: { card: Card; levelNumber: number }) {
  return (
    <article className="card" aria-label={`Debrief card: ${card.title}`}>
      <p className="card-kicker">Debrief card · Level {levelNumber}</p>
      <h3 className="card-title">{card.title}</h3>

      <h4>The idea</h4>
      <RichText text={card.concept} />

      <h4>Today</h4>
      <RichText text={card.today} />

      <h4>From the record</h4>
      <RichText text={card.note} />
      <p className="card-source">
        Source:{' '}
        <a href={card.source.url} target="_blank" rel="noreferrer">
          {card.source.text}
        </a>
      </p>

      {card.simplified !== undefined && (
        <>
          <h4>Where the game simplifies</h4>
          <RichText text={card.simplified} />
        </>
      )}

      {card.commands.length > 0 && (
        <p className="card-meta">
          <strong>Commands you used:</strong>{' '}
          {card.commands.map((command, i) => (
            <span key={command}>
              {i > 0 && ', '}
              <code>{command}</code>
            </span>
          ))}
        </p>
      )}
      {card.domains.length > 0 && (
        <p className="card-meta">
          <strong>Security+ domains:</strong> {card.domains.join(', ')}
        </p>
      )}
    </article>
  )
}

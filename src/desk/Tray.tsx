import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { TrayItem } from '../engine/levels/schema.ts'

export interface TrayProps {
  items: readonly TrayItem[]
  /** True while the player is choosing a line to pin as evidence. */
  picking: boolean
  onPick: (item: TrayItem, text: string) => void
  onCancelPick: () => void
  /** Text of lines already pinned. */
  pinned: ReadonlySet<string>
}

/**
 * The printout tray: transcripts on printer paper and the odd handwritten
 * note. Every line is a separate element so it can be pinned as evidence.
 */
export function Tray({ items, picking, onPick, onCancelPick, pinned }: TrayProps) {
  // Show the newest item unless the player has chosen another.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const linesRef = useRef<HTMLDivElement>(null)
  const selected = items.find((i) => i.id === selectedId) ?? items[items.length - 1]

  useEffect(() => {
    if (picking) linesRef.current?.querySelector<HTMLElement>('[data-pickable]')?.focus()
  }, [picking])

  if (!selected) {
    return <p className="tray-empty">The tray is empty. Printouts land here when there is something to read.</p>
  }

  const lines = selected.text.replace(/\n$/, '').split('\n')

  function onLineKeyDown(event: KeyboardEvent<HTMLDivElement>, text: string): void {
    const all = [...(linesRef.current?.querySelectorAll<HTMLElement>('[data-pickable]') ?? [])]
    const index = all.indexOf(event.currentTarget)
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      all[Math.max(0, index - 1)]?.focus()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      all[Math.min(all.length - 1, index + 1)]?.focus()
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onPick(selected!, text)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onCancelPick()
    }
  }

  return (
    <div className="tray">
      {items.length > 1 && (
        <ul className="tray-list" aria-label="Items in the tray">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="tray-item-button"
                aria-pressed={item.id === selected.id}
                onClick={() => setSelectedId(item.id)}
              >
                {item.title}
              </button>
            </li>
          ))}
        </ul>
      )}

      <article className={`paper paper-${selected.kind}`} aria-label={selected.title}>
        <h3 className="paper-title">{selected.title}</h3>
        <div className="paper-lines" ref={linesRef}>
          {lines.map((text, i) => {
            const isPinned = pinned.has(text) && text.trim() !== ''
            const pickable = picking && text.trim() !== ''
            return (
              <div
                key={i}
                className={`paper-line${isPinned ? ' paper-line-pinned' : ''}`}
                {...(pickable
                  ? {
                      'data-pickable': '',
                      role: 'button',
                      tabIndex: 0,
                      'aria-label': `Pin as evidence: ${text}`,
                      onClick: () => onPick(selected, text),
                      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => onLineKeyDown(event, text),
                    }
                  : {})}
              >
                {isPinned && <span className="paper-pin" title="Pinned as evidence">* </span>}
                {text}
                {isPinned && <span className="visually-hidden"> (pinned as evidence)</span>}
              </div>
            )
          })}
        </div>
      </article>
    </div>
  )
}

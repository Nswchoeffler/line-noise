import {
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import type { TermLine, TerminalModel } from './model.ts'
import './terminal.css'

export interface TerminalProps {
  model: TerminalModel
  /** Lines already pinned as evidence, by id. They get a visible marker. */
  pinned?: ReadonlySet<number>
  /**
   * True while the player is choosing a line to pin. Output lines become
   * buttons: click one, or move with the arrow keys and press Enter.
   */
  picking?: boolean
  onPick?: (line: TermLine) => void
  onCancelPick?: () => void
}

const NO_PINS: ReadonlySet<number> = new Set()

export function Terminal({ model, pinned = NO_PINS, picking = false, onPick, onCancelPick }: TerminalProps) {
  const state = useSyncExternalStore(model.subscribe, model.getState)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const linesRef = useRef<HTMLDivElement>(null)

  // Keep the newest output in view.
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  }, [state.lines, state.pager, state.input])

  // After history recall or completion, put the cursor where the model asked.
  useLayoutEffect(() => {
    if (state.cursorRequest === null) return
    inputRef.current?.setSelectionRange(state.cursorRequest, state.cursorRequest)
    model.cursorPlaced()
  }, [state.cursorRequest, model])

  // Entering pick mode moves focus to the newest output line; leaving it
  // returns focus to the command line.
  useEffect(() => {
    if (picking) {
      const candidates = linesRef.current?.querySelectorAll<HTMLElement>('[data-pickable]')
      candidates?.[candidates.length - 1]?.focus()
    } else {
      inputRef.current?.focus()
    }
  }, [picking])

  const paging = state.pager !== null

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    const input = event.currentTarget
    const ctrl = event.ctrlKey && !event.altKey && !event.metaKey
    const key = event.key

    if (ctrl && key.toLowerCase() === 'c') {
      // With text selected, Ctrl-C is still "copy". Otherwise it interrupts.
      const selectedInInput = input.selectionStart !== input.selectionEnd
      const selectedOnPage = (window.getSelection()?.toString() ?? '') !== ''
      if (selectedInInput || selectedOnPage) return
      event.preventDefault()
      model.interrupt()
      return
    }
    if (ctrl && key.toLowerCase() === 'l') {
      event.preventDefault()
      model.clearScreen()
      return
    }

    if (paging) {
      // While paging, the keyboard drives the pager and nothing is typed.
      if (key === ' ') model.pagerAdvance('page')
      else if (key === 'Enter') model.pagerAdvance('line')
      else if (key === 'q' || key === 'Q' || key === 'Escape') model.pagerQuit()
      if (key !== 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) event.preventDefault()
      return
    }

    if (key === 'Enter') {
      event.preventDefault()
      model.submit()
    } else if (key === 'ArrowUp' && !event.altKey) {
      event.preventDefault()
      model.historyPrevious()
    } else if (key === 'ArrowDown' && !event.altKey) {
      event.preventDefault()
      model.historyNext()
    } else if (key === 'Tab' && !event.shiftKey && !ctrl) {
      // Tab completes. Shift-Tab still moves focus out of the terminal.
      event.preventDefault()
      model.complete(input.selectionStart ?? input.value.length)
    }
  }

  function onLineKeyDown(event: KeyboardEvent<HTMLDivElement>, line: TermLine): void {
    const current = event.currentTarget
    const all = [...(linesRef.current?.querySelectorAll<HTMLElement>('[data-pickable]') ?? [])]
    const index = all.indexOf(current)
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      all[Math.max(0, index - 1)]?.focus()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      all[Math.min(all.length - 1, index + 1)]?.focus()
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onPick?.(line)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onCancelPick?.()
    }
  }

  // A click anywhere on the terminal puts the cursor on the command line,
  // unless the player is selecting text to copy.
  function onTerminalClick(event: MouseEvent<HTMLElement>): void {
    if (picking) return
    if ((window.getSelection()?.toString() ?? '') !== '') return
    if (event.target instanceof HTMLInputElement) return
    inputRef.current?.focus()
  }

  const percent = state.pager
    ? Math.round(((state.pager.total - state.pager.remaining) / state.pager.total) * 100)
    : 0

  return (
    <section
      className={`terminal${picking ? ' terminal-picking' : ''}`}
      aria-label="Terminal"
      onClick={onTerminalClick}
    >
      {picking && (
        <p className="terminal-pick-banner" role="status">
          Choose the line to pin as evidence. Arrow keys move, Enter pins, Esc cancels.
        </p>
      )}
      <div className="terminal-scroll" ref={scrollRef}>
        <div className="terminal-lines" ref={linesRef} role="log" aria-label="Terminal output">
          {state.lines.map((line) => {
            const isPinned = pinned.has(line.id)
            const pickable = picking && line.kind !== 'input' && line.text.trim() !== ''
            return (
              <div
                key={line.id}
                className={`line line-${line.kind}${isPinned ? ' line-pinned' : ''}`}
                {...(pickable
                  ? {
                      'data-pickable': '',
                      role: 'button',
                      tabIndex: 0,
                      'aria-label': `Pin as evidence: ${line.text}`,
                      onClick: () => onPick?.(line),
                      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => onLineKeyDown(event, line),
                    }
                  : {})}
              >
                <span className="line-gutter" aria-hidden={!isPinned}>
                  {isPinned ? <span title="Pinned as evidence">*</span> : ' '}
                </span>
                <span className="line-text">
                  {line.kind === 'input' && <span className="prompt">{line.prompt}</span>}
                  {line.text}
                </span>
                {isPinned && <span className="visually-hidden"> (pinned as evidence)</span>}
              </div>
            )
          })}
        </div>

        <div className="terminal-entry">
          <span className="line-gutter"> </span>
          <label className="prompt" htmlFor="terminal-input">
            {paging ? `--More--(${percent}%) ` : state.prompt}
          </label>
          <input
            id="terminal-input"
            ref={inputRef}
            className="terminal-input"
            type="text"
            value={paging ? '' : state.input}
            readOnly={paging}
            onChange={(event) => model.setInput(event.target.value)}
            onKeyDown={onInputKeyDown}
            aria-label={paging ? 'Paging: Space for the next page, Enter for one line, q to stop' : 'Command line'}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus
          />
          {paging && <span className="pager-hint">Space: next page · Enter: one line · q: stop</span>}
        </div>
      </div>
    </section>
  )
}

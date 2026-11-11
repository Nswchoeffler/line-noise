import { completeLine } from '../../engine/shell/complete.ts'
import type { TerminalBackend } from '../../engine/levels/runner.ts'
import type { CommandRecord } from '../../engine/shell/session.ts'

export type LineKind = 'input' | 'out' | 'err' | 'info'

/** One row of the screen. Each is a separate element, so it can be pinned as evidence. */
export interface TermLine {
  id: number
  kind: LineKind
  text: string
  /** For input lines: the prompt it was typed at. */
  prompt?: string
}

export interface TerminalState {
  lines: readonly TermLine[]
  prompt: string
  /** What is on the command line now. */
  input: string
  /** Lines waiting to be shown, while paging through long output. Null otherwise. */
  pager: { remaining: number; total: number } | null
  /** Where the cursor should be put after a completion, then cleared by the view. */
  cursorRequest: number | null
}

export interface TerminalOptions {
  /** Lines shown before a `--More--` pause. */
  pageSize?: number
  /** Called after every line the player runs. */
  onRecord?: (record: CommandRecord) => void
}

const MAX_SCROLLBACK = 2000
const SCREEN_WIDTH = 80

function splitLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function inColumns(names: string[]): string[] {
  const width = Math.max(...names.map((n) => n.length)) + 2
  const perRow = Math.max(1, Math.floor(SCREEN_WIDTH / width))
  const rows: string[] = []
  for (let i = 0; i < names.length; i += perRow) {
    rows.push(
      names
        .slice(i, i + perRow)
        .map((n) => n.padEnd(width))
        .join('')
        .trimEnd(),
    )
  }
  return rows
}

/**
 * Everything the terminal does that is not drawing: scrollback, the command
 * line, history, completion and paging. It knows nothing about the browser,
 * so it can be tested directly; the React component only draws its state and
 * forwards keys.
 */
export class TerminalModel {
  private shell: TerminalBackend
  private readonly pageSize: number
  private readonly onRecord: ((record: CommandRecord) => void) | undefined
  private readonly listeners = new Set<() => void>()

  private lines: TermLine[] = []
  private nextId = 1
  private input = ''
  /** Position in history while browsing with the arrow keys; null when not browsing. */
  private historyIndex: number | null = null
  /** What was being typed before browsing history, restored on the way back down. */
  private draft = ''
  private pending: TermLine[] = []
  private pendingTotal = 0
  private cursorRequest: number | null = null
  private state: TerminalState

  constructor(shell: TerminalBackend, options: TerminalOptions = {}) {
    this.shell = shell
    this.pageSize = options.pageSize ?? 22
    this.onRecord = options.onRecord
    this.state = this.buildState()
  }

  // ---- subscription (for React's useSyncExternalStore) -----------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState = (): TerminalState => this.state

  private buildState(): TerminalState {
    return {
      lines: this.lines,
      prompt: this.shell.prompt,
      input: this.input,
      pager:
        this.pending.length > 0
          ? { remaining: this.pending.length, total: this.pendingTotal }
          : null,
      cursorRequest: this.cursorRequest,
    }
  }

  private changed(): void {
    this.lines = this.lines.slice(-MAX_SCROLLBACK)
    this.state = this.buildState()
    for (const listener of this.listeners) listener()
  }

  private makeLine(kind: LineKind, text: string, prompt?: string): TermLine {
    return { id: this.nextId++, kind, text, ...(prompt === undefined ? {} : { prompt }) }
  }

  // ---- output ----------------------------------------------------------------

  /** Write lines to the screen from outside the shell, such as a login banner. */
  print(text: string, kind: LineKind = 'info'): void {
    for (const line of splitLines(text)) this.lines.push(this.makeLine(kind, line))
    this.changed()
  }

  /** Attach to a different session (another host), keeping the scrollback. */
  attach(shell: TerminalBackend): void {
    this.shell = shell
    this.input = ''
    this.historyIndex = null
    this.pending = []
    this.changed()
  }

  // ---- the command line ------------------------------------------------------

  setInput(text: string): void {
    this.input = text
    this.cursorRequest = null
    this.changed()
  }

  /** The view calls this once it has moved the cursor where a completion asked. */
  cursorPlaced(): void {
    if (this.cursorRequest === null) return
    this.cursorRequest = null
    this.state = this.buildState()
  }

  /** Enter: run the command line. */
  submit(): void {
    if (this.pending.length > 0) return
    const line = this.input
    this.lines.push(this.makeLine('input', line, this.shell.prompt))
    this.input = ''
    this.historyIndex = null
    this.draft = ''
    this.cursorRequest = null

    const record = this.shell.run(line)
    if (record.clear) this.lines = []

    const output: TermLine[] = []
    for (const chunk of record.output) {
      for (const text of splitLines(chunk.text)) {
        output.push(this.makeLine(chunk.stream === 'err' ? 'err' : 'out', text))
      }
    }

    if (record.page && output.length > this.pageSize) {
      this.lines.push(...output.slice(0, this.pageSize))
      this.pending = output.slice(this.pageSize)
      this.pendingTotal = output.length
    } else {
      this.lines.push(...output)
    }

    this.changed()
    this.onRecord?.(record)
  }

  /** Up arrow: the previous command in history. */
  historyPrevious(): void {
    const history = this.shell.history
    if (history.length === 0) return
    if (this.historyIndex === null) {
      this.draft = this.input
      this.historyIndex = history.length - 1
    } else if (this.historyIndex > 0) {
      this.historyIndex--
    }
    this.input = history[this.historyIndex]!
    this.cursorRequest = this.input.length
    this.changed()
  }

  /** Down arrow: the next command in history, ending back at what was being typed. */
  historyNext(): void {
    if (this.historyIndex === null) return
    const history = this.shell.history
    if (this.historyIndex < history.length - 1) {
      this.historyIndex++
      this.input = history[this.historyIndex]!
    } else {
      this.historyIndex = null
      this.input = this.draft
    }
    this.cursorRequest = this.input.length
    this.changed()
  }

  /** Tab: complete the word at the cursor. Shows the choices when there are several. */
  complete(cursor: number): void {
    const result = completeLine(this.shell.env, this.input, cursor)
    if (result.candidates.length > 0) {
      this.lines.push(this.makeLine('input', this.input, this.shell.prompt))
      for (const row of inColumns(result.candidates)) this.lines.push(this.makeLine('info', row))
    }
    this.input = result.line
    this.cursorRequest = result.cursor
    this.changed()
  }

  /** Ctrl-C: abandon the line being typed, or stop paging. */
  interrupt(): void {
    if (this.pending.length > 0) {
      this.pending = []
    } else {
      this.lines.push(this.makeLine('input', `${this.input}^C`, this.shell.prompt))
      this.input = ''
      this.historyIndex = null
    }
    this.cursorRequest = null
    this.changed()
  }

  /** Ctrl-L: wipe the screen, keeping what is being typed. */
  clearScreen(): void {
    this.lines = []
    this.pending = []
    this.changed()
  }

  // ---- paging ----------------------------------------------------------------

  /** Space shows the next screenful; Enter shows one more line. */
  pagerAdvance(amount: 'page' | 'line'): void {
    if (this.pending.length === 0) return
    const count = amount === 'page' ? this.pageSize : 1
    this.lines.push(...this.pending.slice(0, count))
    this.pending = this.pending.slice(count)
    this.changed()
  }

  /** q: stop paging and drop the rest. */
  pagerQuit(): void {
    if (this.pending.length === 0) return
    this.pending = []
    this.changed()
  }
}

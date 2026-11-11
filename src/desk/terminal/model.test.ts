import { beforeEach, describe, expect, it } from 'vitest'
import type { CommandRecord } from '../../engine/shell/session.ts'
import { fixture, type Fixture } from '../../engine/shell/testing.ts'
import { TerminalModel } from './model.ts'

let t: Fixture
let term: TerminalModel
let records: CommandRecord[]

/** Type a line and press Enter. */
function enter(line: string): void {
  term.setInput(line)
  term.submit()
}

/** The screen as text: prompts included on input lines. */
function screen(): string[] {
  return term.getState().lines.map((l) => (l.kind === 'input' ? `${l.prompt}${l.text}` : l.text))
}

beforeEach(() => {
  t = fixture()
  records = []
  term = new TerminalModel(t.shell, { pageSize: 5, onRecord: (r) => records.push(r) })
  const content = Array.from({ length: 12 }, (_, i) => `line ${i + 1}\n`).join('')
  t.host.fs.install('/home/alice/long', { content, uid: 101, gid: 10 })
  t.host.fs.install('/home/alice/notes', { content: 'hello\n', uid: 101, gid: 10 })
})

describe('running commands', () => {
  it('echoes the line with its prompt, then the output', () => {
    enter('echo hello')
    expect(screen()).toEqual(['testhost$ echo hello', 'hello'])
    expect(term.getState().input).toBe('')
  })

  it('puts each output line on its own row with a unique id', () => {
    enter('echo one; echo two')
    const lines = term.getState().lines
    expect(lines.map((l) => l.text)).toEqual(['echo one; echo two', 'one', 'two'])
    expect(new Set(lines.map((l) => l.id)).size).toBe(3)
  })

  it('marks errors as errors', () => {
    enter('cat /nope')
    expect(term.getState().lines.map((l) => l.kind)).toEqual(['input', 'err'])
  })

  it('keeps blank lines in output', () => {
    enter("echo 'a'; echo; echo 'b'")
    expect(screen().slice(1)).toEqual(['a', '', 'b'])
  })

  it('shows a new prompt for an empty line', () => {
    enter('')
    enter('')
    expect(screen()).toEqual(['testhost$ ', 'testhost$ '])
  })

  it('reports each record to the listener', () => {
    enter('pwd')
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ line: 'pwd', status: 0 })
  })

  it('follows the shell prompt, which changes for root', () => {
    t.host.fs.install('/tmp/rootsh', { program: 'sh', mode: 0o4755, uid: 0 })
    expect(term.getState().prompt).toBe('testhost$ ')
    enter('/tmp/rootsh')
    expect(term.getState().prompt).toBe('testhost# ')
    enter('whoami')
    expect(screen().slice(-2)).toEqual(['testhost# whoami', 'root'])
  })

  it('wipes the screen for the clear command', () => {
    enter('echo gone')
    enter('clear')
    expect(screen()).toEqual([])
  })

  it('notifies subscribers of every change and stops when asked', () => {
    let calls = 0
    const stop = term.subscribe(() => calls++)
    enter('pwd')
    expect(calls).toBe(2) // typing, then running
    stop()
    enter('pwd')
    expect(calls).toBe(2)
  })

  it('gives a new state object only when something changed', () => {
    const before = term.getState()
    expect(term.getState()).toBe(before)
    term.setInput('x')
    expect(term.getState()).not.toBe(before)
  })
})

describe('history with the arrow keys', () => {
  beforeEach(() => {
    enter('echo one')
    enter('echo two')
    enter('echo three')
  })

  it('walks back through earlier commands and stops at the oldest', () => {
    term.historyPrevious()
    expect(term.getState().input).toBe('echo three')
    term.historyPrevious()
    term.historyPrevious()
    expect(term.getState().input).toBe('echo one')
    term.historyPrevious()
    expect(term.getState().input).toBe('echo one')
  })

  it('walks forward again and restores what was being typed', () => {
    term.setInput('half-typed')
    term.historyPrevious()
    term.historyPrevious()
    expect(term.getState().input).toBe('echo two')
    term.historyNext()
    expect(term.getState().input).toBe('echo three')
    term.historyNext()
    expect(term.getState().input).toBe('half-typed')
    term.historyNext()
    expect(term.getState().input).toBe('half-typed')
  })

  it('puts the cursor at the end of a recalled command', () => {
    term.historyPrevious()
    expect(term.getState().cursorRequest).toBe('echo three'.length)
    term.cursorPlaced()
    expect(term.getState().cursorRequest).toBeNull()
  })

  it('runs a recalled command and starts from the newest again', () => {
    term.historyPrevious()
    term.historyPrevious()
    term.submit()
    expect(screen().slice(-2)).toEqual(['testhost$ echo two', 'two'])
    term.historyPrevious()
    expect(term.getState().input).toBe('echo two')
  })

  it('does nothing when there is no history', () => {
    const fresh = new TerminalModel(fixture().shell)
    fresh.historyPrevious()
    fresh.historyNext()
    expect(fresh.getState().input).toBe('')
  })
})

describe('tab completion', () => {
  it('finishes a unique match and asks for the cursor at its end', () => {
    term.setInput('cat no')
    term.complete(6)
    expect(term.getState()).toMatchObject({ input: 'cat notes ', cursorRequest: 10 })
    expect(screen()).toEqual([])
  })

  it('lists the choices when there are several, then shows the prompt again', () => {
    term.setInput('cat ')
    term.complete(4)
    expect(screen()).toEqual(['testhost$ cat ', 'long   notes'])
    expect(term.getState().input).toBe('cat ')
  })

  it('completes at the cursor, not only at the end', () => {
    term.setInput('cat no | wc')
    term.complete(6)
    expect(term.getState()).toMatchObject({ input: 'cat notes | wc', cursorRequest: 9 })
  })

  it('leaves the line alone when nothing matches', () => {
    term.setInput('cat zz')
    term.complete(6)
    expect(term.getState().input).toBe('cat zz')
  })
})

describe('Ctrl-C and Ctrl-L', () => {
  it('Ctrl-C abandons the line, showing it with ^C', () => {
    term.setInput('rm -r everything')
    term.interrupt()
    expect(screen()).toEqual(['testhost$ rm -r everything^C'])
    expect(term.getState().input).toBe('')
    expect(records).toEqual([])
    expect(t.shell.history).toEqual([])
  })

  it('Ctrl-L wipes the screen and keeps the line being typed', () => {
    enter('echo hello')
    term.setInput('half')
    term.clearScreen()
    expect(screen()).toEqual([])
    expect(term.getState().input).toBe('half')
  })
})

describe('paging long output', () => {
  it('shows one screenful, then waits', () => {
    enter('more long')
    expect(screen()).toEqual(['testhost$ more long', 'line 1', 'line 2', 'line 3', 'line 4', 'line 5'])
    expect(term.getState().pager).toEqual({ remaining: 7, total: 12 })
  })

  it('shows the next screenful on space and one line on Enter', () => {
    enter('more long')
    term.pagerAdvance('line')
    expect(screen().at(-1)).toBe('line 6')
    term.pagerAdvance('page')
    expect(screen().at(-1)).toBe('line 11')
    expect(term.getState().pager).toEqual({ remaining: 1, total: 12 })
    term.pagerAdvance('page')
    expect(screen().at(-1)).toBe('line 12')
    expect(term.getState().pager).toBeNull()
  })

  it('drops the rest on q', () => {
    enter('more long')
    term.pagerQuit()
    expect(term.getState().pager).toBeNull()
    expect(screen().at(-1)).toBe('line 5')
  })

  it('stops paging on Ctrl-C without printing ^C', () => {
    enter('more long')
    term.interrupt()
    expect(term.getState().pager).toBeNull()
    expect(screen().at(-1)).toBe('line 5')
  })

  it('ignores Enter-to-run while paging', () => {
    enter('more long')
    term.submit()
    expect(records).toHaveLength(1)
  })

  it('does not page output that fits, or output that is piped', () => {
    enter('more notes')
    expect(term.getState().pager).toBeNull()
    enter('more long | cat')
    expect(term.getState().pager).toBeNull()
    expect(screen().at(-1)).toBe('line 12')
  })
})

describe('other output', () => {
  it('prints text from outside the shell', () => {
    term.print('Welcome.\nLast login: yesterday\n')
    expect(term.getState().lines.map((l) => [l.kind, l.text])).toEqual([
      ['info', 'Welcome.'],
      ['info', 'Last login: yesterday'],
    ])
  })

  it('keeps the scrollback when attached to another session', () => {
    enter('whoami')
    term.attach(t.login('bob').shell)
    enter('whoami')
    expect(screen()).toEqual(['testhost$ whoami', 'alice', 'testhost$ whoami', 'bob'])
  })

  it('caps the scrollback', () => {
    for (let i = 0; i < 1100; i++) enter('echo x')
    expect(term.getState().lines.length).toBe(2000)
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { loadGame, type LoadedGame } from '../engine/levels/loader.ts'
import { boardSource, testSource } from '../engine/levels/testing.ts'
import { programs } from '../engine/shell/commands/index.ts'
import { Game, type GameSnapshot } from './game.ts'

let content: LoadedGame
let game: Game

/** Type a line at the game's terminal, as the player would. */
function type(g: Game, line: string): void {
  const { terminal } = g.getState()
  terminal.setInput(line)
  terminal.submit()
}

const screen = (g: Game): string[] =>
  g.getState().terminal.getState().lines.map((l) => (l.kind === 'input' ? `${l.prompt}${l.text}` : l.text))

/** Play the first test level up to (not including) its final logbook entry. */
function playMostOfLevelOne(g: Game): void {
  const { session } = g.getState()
  session.begin()
  session.continue()
  type(g, 'cd /data')
  type(g, 'cat list')
  type(g, 'sort list | uniq -c')
  session.answer('finding', { kind: 'fill', values: { name: 'alpha', count: '2' } })
  session.continue()
  session.continue()
}

function finishLevelOne(g: Game): void {
  playMostOfLevelOne(g)
  g.getState().session.answer('which', { kind: 'choose', chosen: ['a', 'c'] })
}

beforeEach(() => {
  content = loadGame(testSource())
  game = new Game(content, programs)
})

describe('a new game', () => {
  it('opens the first level at its briefing', () => {
    const state = game.getState()
    expect(state.levelIndex).toBe(0)
    expect(state.loaded.level.id).toBe('L01-first')
    expect(state.session.getState().phase).toBe('brief')
    expect(state.completed).toEqual([])
    expect(state.finished).toBe(false)
  })

  it('greets the player on the terminal with the host name', () => {
    expect(screen(game)).toEqual(['Connected to box.'])
  })

  it('has no cards yet, and nothing worth saving', () => {
    expect(game.cards).toEqual([])
    expect(game.snapshot()).toEqual({ completed: [], current: null })
  })
})

describe('playing through', () => {
  it('routes terminal commands through the level', () => {
    game.getState().session.begin()
    game.getState().session.continue()
    type(game, 'cd /data')
    expect(game.getState().session.getState().beatIndex).toBe(2)
    expect(screen(game)).toEqual(['Connected to box.', 'box$ cd /data'])
  })

  it('marks a level completed and files its card as soon as it is done', () => {
    finishLevelOne(game)
    expect(game.getState().completed).toEqual(['L01-first'])
    expect(game.cards.map((c) => c.card.title)).toEqual(['Logs are evidence'])
    expect(game.hasNextLevel).toBe(true)
  })

  it('does not move on until the level is complete', () => {
    playMostOfLevelOne(game)
    game.next()
    expect(game.getState().levelIndex).toBe(0)
  })

  it('moves to the next level, with a fresh world and terminal', () => {
    type(game, 'echo scratch > /tmp/mine')
    finishLevelOne(game)
    game.next()
    const state = game.getState()
    expect(state.loaded.level.id).toBe('L02-second')
    expect(state.session.getState().phase).toBe('brief')
    expect(state.session.world.host('box').fs.peek('/tmp/mine')).toBeUndefined()
    expect(screen(game)).toEqual(['Connected to box.'])
  })

  it('announces a change of host on the terminal', () => {
    finishLevelOne(game)
    game.next()
    game.getState().session.begin() // the level's first beat connects to the sandbox
    expect(screen(game)).toEqual(['Connected to box.', 'Connected to sandbox.', 'This is the sandbox.'])
    type(game, 'whoami')
    expect(screen(game).slice(-2)).toEqual(['sandbox$ whoami', 'ops'])
  })

  function finishLevelTwo(g: Game): void {
    const { session } = g.getState()
    session.begin()
    type(g, 'ls -l /usr/local/bin/helper')
    const listing = screen(g).at(-1)!
    type(g, 'helper')
    type(g, '/tmp/rootsh')
    type(g, 'chmod u-s /usr/local/bin/helper')
    type(g, 'exit')
    type(g, 'helper')
    session.answer('proof', { kind: 'pin', text: listing, source: 'terminal' })
    session.answer('fix', { kind: 'write', text: 'Remove the setuid bit from the helper.' })
  }

  it('finishes the game after the last level', () => {
    finishLevelOne(game)
    game.next()
    finishLevelTwo(game)
    expect(game.hasNextLevel).toBe(false)
    expect(game.getState().finished).toBe(false)
    game.next()
    expect(game.getState().finished).toBe(true)
    expect(game.cards).toHaveLength(2)
  })

  it('tells subscribers when the level changes or progresses', () => {
    let calls = 0
    game.subscribe(() => calls++)
    game.getState().session.begin()
    expect(calls).toBe(1)
    game.restartLevel()
    expect(calls).toBe(2)
  })

  it('restarts a level from its beginning', () => {
    game.getState().session.begin()
    type(game, 'echo x > /tmp/x')
    game.restartLevel()
    const { session } = game.getState()
    expect(session.getState().phase).toBe('brief')
    expect(session.world.host('box').fs.peek('/tmp/x')).toBeUndefined()
  })

  it('lets the player go back to a level they have reached, but not ahead', () => {
    game.goToLevel(1)
    expect(game.getState().levelIndex).toBe(0)
    finishLevelOne(game)
    game.next()
    game.goToLevel(0)
    expect(game.getState().levelIndex).toBe(0)
    expect(game.getState().completed).toEqual(['L01-first'])
    game.goToLevel(1)
    expect(game.getState().levelIndex).toBe(1)
  })

  it('lists the manual pages on the current host', () => {
    expect(game.manualPages()).toEqual([])
    const host = game.getState().session.shell.host
    host.fs.install('/usr/man/man1/ls.1', { content: 'LS(1)\n' })
    host.fs.install('/usr/man/man8/atrun.8', { content: 'ATRUN(8)\n' })
    expect(game.manualPages()).toEqual([
      { name: 'atrun', section: '8', text: 'ATRUN(8)\n' },
      { name: 'ls', section: '1', text: 'LS(1)\n' },
    ])
  })
})

describe('saving and resuming', () => {
  /** Save, pass through JSON as storage would, and start a new game from it. */
  function reload(g: Game): Game {
    const saved: GameSnapshot = JSON.parse(JSON.stringify(g.snapshot()))
    return new Game(content, programs, saved)
  }

  it('resumes in the middle of a level exactly where the player left off', () => {
    const { session } = game.getState()
    session.begin()
    session.continue()
    type(game, 'cd /data')
    type(game, 'cat list')
    type(game, 'echo mine > /tmp/mine')

    const resumed = reload(game)
    expect(resumed.getState().session.getState()).toEqual(session.getState())
    expect(resumed.getState().session.world.serialize()).toEqual(session.world.serialize())
    expect(resumed.getState().session.shell.cwd).toBe('/data')
    expect(screen(resumed)).toEqual(screen(game))
    expect(resumed.snapshot()).toEqual(game.snapshot())
  })

  it('resumes in the middle of a board puzzle, with the board as it was left', () => {
    content = loadGame(boardSource())
    game = new Game(content, programs, { completed: ['L01-first'], current: null })
    const { session } = game.getState()
    session.begin()
    session.continue()
    session.move({ do: 'go', room: 'vault' })
    session.move({ do: 'write', card: 'key' })
    session.move({ do: 'send', spot: 'peg' })

    const resumed = reload(game)
    const state = resumed.getState().session.getState()
    expect(state).toEqual(session.getState())
    expect(state.puzzle!.play.state).toMatchObject({ hand: null, turnedAway: ['vault'] })
    expect(state.puzzle!.play.state.spots['peg']?.card).toBe('key')

    // And it carries on from there.
    resumed.getState().session.move({ do: 'wait' })
    expect(resumed.getState().session.getState().puzzle!.play.solved).toBe(true)
  })

  it('keeps logbook answers, including wrong ones', () => {
    playMostOfLevelOne(game)
    game.getState().session.answer('which', { kind: 'choose', chosen: ['a', 'b'] })
    const resumed = reload(game)
    const which = resumed.getState().session.getState().logbook.find((e) => e.entry.id === 'which')!
    expect(which).toMatchObject({ complete: false, answer: { kind: 'choose', chosen: ['a', 'b'] } })
    expect(resumed.getState().session.getState().logbook[0]!.complete).toBe(true)
  })

  it('resumes at the next level after a completed one', () => {
    finishLevelOne(game)
    const resumed = reload(game)
    expect(resumed.getState().loaded.level.id).toBe('L02-second')
    expect(resumed.getState().completed).toEqual(['L01-first'])
    expect(resumed.cards).toHaveLength(1)
  })

  it('resumes on a second host with the session intact', () => {
    finishLevelOne(game)
    game.next()
    game.getState().session.begin()
    type(game, 'helper')
    type(game, '/tmp/rootsh')

    const resumed = reload(game)
    expect(resumed.getState().session.prompt).toBe('sandbox# ')
    expect(screen(resumed)).toEqual(screen(game))
  })

  it('remembers that the game was finished', () => {
    const snapshot: GameSnapshot = { completed: ['L01-first', 'L02-second'], current: null }
    const resumed = new Game(content, programs, snapshot)
    expect(resumed.getState().finished).toBe(true)
    expect(resumed.cards).toHaveLength(2)
  })

  it('ignores saved levels that no longer exist', () => {
    const snapshot: GameSnapshot = {
      completed: ['L01-first', 'L99-removed'],
      current: { level: 'L98-also-removed', events: [{ type: 'begin' }] },
    }
    const resumed = new Game(content, programs, snapshot)
    expect(resumed.getState().completed).toEqual(['L01-first'])
    expect(resumed.getState().loaded.level.id).toBe('L02-second')
  })

  it('forgets everything on reset', () => {
    finishLevelOne(game)
    game.next()
    game.reset()
    expect(game.getState().levelIndex).toBe(0)
    expect(game.snapshot()).toEqual({ completed: [], current: null })
    expect(game.cards).toEqual([])
  })
})

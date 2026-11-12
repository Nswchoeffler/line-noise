import { describe, expect, it } from 'vitest'
import { holdsAll, initialState, legalMoves, playMove, stageMoves, startStage, step, type BoardState } from './board.ts'
import { BoardSpecSchema, boardFor, LINE_KEYS, PuzzleSchema, type BoardSpec, type Move, type Puzzle } from './schema.ts'

// A small, story-free board: a hall anyone may enter, a vault only a gold
// badge opens, a runner who carries cards, and a warden who obeys a peg.

/** Each line is its own key and the values it was given, so tests can read what happened. */
const LINES = Object.fromEntries(
  LINE_KEYS.map((key) => [key, `${key}: {badge}|{room}|{spot}|{card}|{old}|{time}|{change}`]),
)

const BOARD = {
  start: '09:00',
  badges: { tin: 'TIN', gold: 'GOLD' },
  rooms: {
    hall: { name: 'Hall', opens_for: ['tin', 'gold'] },
    vault: { name: 'Vault', opens_for: ['gold'] },
  },
  spots: {
    shelf: { name: 'shelf', room: 'hall' },
    peg: { name: 'peg', room: 'vault', holds: 'sweep', changed: 'long ago' },
  },
  cards: {
    sweep: { text: 'Sweep up.' },
    key: { text: 'Hand over gold.', grants: { badge: 'gold', in: 'hall' } },
  },
  player: { room: 'hall', badges: ['tin'] },
  courier: { name: 'Runner', room: 'hall', badge: 'gold' },
  round: { name: 'Warden', badge: 'gold', every: 10, reads: 'peg' },
  lines: LINES,
}

const board = (patch: Record<string, unknown> = {}): BoardSpec => BoardSpecSchema.parse({ ...BOARD, ...patch })

/** Make moves in order from the start. */
function after(spec: BoardSpec, ...moves: Move[]): BoardState {
  let state = initialState(spec)
  for (const move of moves) {
    if (move.do !== 'fix' && move.do !== 'reset') state = step(spec, state, move)
  }
  return state
}

const keys = (state: BoardState): string[] => state.log.map((line) => line.key)

const TRICK: Move[] = [{ do: 'write', card: 'key' }, { do: 'send', spot: 'peg' }, { do: 'wait' }]

describe('a board description', () => {
  it('fills in what is left out', () => {
    const spec = board({ courier: undefined, round: undefined, start: undefined })
    expect(spec).toMatchObject({ courier: null, round: null, start: '00:00' })
    expect(spec.spots['shelf']).toEqual({ name: 'shelf', room: 'hall', holds: null, changed: null, covered: false })
    expect(spec.cards['sweep']).toEqual({ text: 'Sweep up.', found: false })
  })

  it('refuses a board that refers to things that are not on it', () => {
    const bad = (patch: Record<string, unknown>): (() => unknown) => () => board(patch)
    expect(bad({ player: { room: 'attic', badges: ['tin'] } })).toThrow(/no room called .*attic/)
    expect(bad({ player: { room: 'hall', badges: ['brass'] } })).toThrow(/no badge called .*brass/)
    expect(bad({ round: { ...BOARD.round, reads: 'nail' } })).toThrow(/no spot called .*nail/)
    expect(bad({ courier: { ...BOARD.courier, badge: 'brass' } })).toThrow(/no badge called .*brass/)
    expect(bad({ spots: { peg: { name: 'peg', room: 'vault', holds: 'ghost' } } })).toThrow(/no card called .*ghost/)
  })

  it('needs every line the board can print', () => {
    const { you_enter: _dropped, ...rest } = LINES
    expect(() => board({ lines: rest })).toThrow('you_enter')
    const { courier_declines: _courier, ...noCourier } = LINES
    expect(() => board({ lines: noCourier })).toThrow('courier_declines')
    const { round_empty: _round, ...noRound } = LINES
    expect(() => board({ lines: noRound })).toThrow('round_empty')
  })

  it('needs no line for something that is not on the board', () => {
    const { you_enter, you_refused } = LINES
    const bare = { ...BOARD, spots: {}, cards: {}, courier: null, round: null, lines: { you_enter, you_refused } }
    expect(BoardSpecSchema.parse(bare).lines).toEqual({ you_enter, you_refused })
    // Somewhere to look means the lines for looking.
    const drawer = { drawer: { name: 'drawer', room: 'hall', holds: 'memo', covered: true } }
    const memo = { memo: { text: 'A memo.', found: true } }
    expect(() => BoardSpecSchema.parse({ ...bare, spots: drawer, cards: memo })).toThrow('you_read')
  })

  it('checks that a note tells a code the board knows', () => {
    expect(() => board({ cards: { ...BOARD.cards, memo: { text: 'A memo.', tells: 'brass', found: true } } })).toThrow(
      /no badge called .*brass/,
    )
  })
})

// Notes left lying about: a drawer in the hall, and a locker in the vault,
// each holding somebody else's card. One of them gives away the gold code.
const NOTES = {
  spots: {
    ...BOARD.spots,
    drawer: { name: 'drawer', room: 'hall', holds: 'memo', covered: true },
    locker: { name: 'locker', room: 'vault', holds: 'chit', covered: true },
  },
  cards: {
    ...BOARD.cards,
    memo: { text: 'The vault code is gold.', tells: 'gold', found: true },
    chit: { text: 'Milk, two pints.', found: true },
  },
  courier: null,
  round: null,
}

describe('notes left lying about', () => {
  it('can be looked at only from the room they are in, and only while unread', () => {
    const spec = board(NOTES)
    const reads = (state: BoardState): Move[] => legalMoves(spec, state).filter((m) => m.do === 'read')
    expect(reads(initialState(spec))).toEqual([{ do: 'read', spot: 'drawer' }])
    // The locker is behind a door, and an open shelf needs no looking at.
    const fresh = initialState(spec)
    expect(step(spec, fresh, { do: 'read', spot: 'locker' })).toBe(fresh)
    expect(step(spec, fresh, { do: 'read', spot: 'shelf' })).toBe(fresh)
    const looked = step(spec, fresh, { do: 'read', spot: 'drawer' })
    expect(looked.seen).toEqual(['drawer'])
    expect(reads(looked)).toEqual([])
  })

  it('tell the reader a code, which opens a door like any badge', () => {
    const spec = board(NOTES)
    expect(after(spec, { do: 'go', room: 'vault' }).room).toBe('hall')
    const state = after(spec, { do: 'read', spot: 'drawer' }, { do: 'go', room: 'vault' })
    expect(keys(state)).toEqual(['you_read', 'you_learn', 'you_enter'])
    expect(state.log[0]!.text).toContain('Hall|drawer|The vault code is gold.')
    expect(state.log[1]!.text).toContain('GOLD')
    expect(state.badges).toEqual(['tin', 'gold'])
    expect(state.room).toBe('vault')
    expect(holdsAll(state, [{ player_has: 'gold' }, { player_in: 'vault' }])).toBe(true)
  })

  it('say nothing new to someone who has the code already, or when they hold no code', () => {
    const knows = board({ ...NOTES, player: { room: 'hall', badges: ['tin', 'gold'] } })
    const again = after(knows, { do: 'read', spot: 'drawer' })
    expect(keys(again)).toEqual(['you_read'])
    expect(again.badges).toEqual(['tin', 'gold'])
    const plain = after(knows, { do: 'go', room: 'vault' }, { do: 'read', spot: 'locker' })
    expect(keys(plain)).toEqual(['you_enter', 'you_read'])
    expect(plain.badges).toEqual(['tin', 'gold'])
  })

  it('cannot be written by the player, and an empty spot has nothing to look at', () => {
    const spec = board(NOTES)
    const writes = legalMoves(spec, initialState(spec)).filter((m) => m.do === 'write')
    expect(writes).toEqual([
      { do: 'write', card: 'sweep' },
      { do: 'write', card: 'key' },
    ])
    const fresh = initialState(spec)
    expect(step(spec, fresh, { do: 'write', card: 'memo' })).toBe(fresh)
    const empty = board({ ...NOTES, spots: { ...NOTES.spots, drawer: { name: 'drawer', room: 'hall', covered: true } } })
    expect(legalMoves(empty, initialState(empty)).filter((m) => m.do === 'read')).toEqual([])
  })

  it('must be looked at again once something else has been put there', () => {
    const spec = board(NOTES)
    const state = after(spec, { do: 'read', spot: 'drawer' }, { do: 'write', card: 'sweep' }, { do: 'place', spot: 'drawer' })
    expect(state.seen).toEqual([])
    expect(legalMoves(spec, state)).toContainEqual({ do: 'read', spot: 'drawer' })
  })
})

describe('doors', () => {
  it('open for a badge on their list', () => {
    const state = after(board(), { do: 'go', room: 'vault' })
    expect(state.room).toBe('hall')
    expect(state.turnedAway).toEqual(['vault'])
    expect(state.log.at(-1)).toEqual({ key: 'you_refused', text: 'you_refused: TIN|Vault|{spot}|{card}|{old}|{time}|{change}' })
  })

  it('let in anyone holding a badge that fits, and show that badge', () => {
    const spec = board({ player: { room: 'hall', badges: ['tin', 'gold'] } })
    const state = after(spec, { do: 'go', room: 'vault' })
    expect(state.room).toBe('vault')
    expect(state.log.at(-1)?.text).toContain('GOLD|Vault')
    expect(state.turnedAway).toEqual([])
  })

  it('remember being tried only once', () => {
    const state = after(board(), { do: 'go', room: 'vault' }, { do: 'go', room: 'vault' })
    expect(state.turnedAway).toEqual(['vault'])
    expect(keys(state)).toEqual(['you_refused', 'you_refused'])
  })
})

describe('the moves on offer', () => {
  it('are only the ones that can be made', () => {
    const spec = board()
    const start = initialState(spec)
    expect(legalMoves(spec, start)).toEqual([
      { do: 'go', room: 'vault' },
      { do: 'write', card: 'sweep' },
      { do: 'write', card: 'key' },
      { do: 'wait' },
    ])
    const holding = step(spec, start, { do: 'write', card: 'key' })
    expect(legalMoves(spec, holding)).toEqual(
      expect.arrayContaining([
        { do: 'place', spot: 'shelf' },
        { do: 'send', spot: 'shelf' },
        { do: 'send', spot: 'peg' },
      ]),
    )
    // The peg is in another room: it can be sent to, not reached.
    expect(legalMoves(spec, holding)).not.toContainEqual({ do: 'place', spot: 'peg' })
  })

  it('leave out writing when there is nowhere for a card to go', () => {
    const spec = board({ spots: {}, round: null })
    expect(legalMoves(spec, initialState(spec))).toEqual([{ do: 'go', room: 'vault' }])
  })

  it('change nothing when a move is not possible', () => {
    const spec = board()
    const start = initialState(spec)
    expect(step(spec, start, { do: 'go', room: 'hall' })).toBe(start)
    expect(step(spec, start, { do: 'place', spot: 'shelf' })).toBe(start)
    expect(step(spec, start, { do: 'send', spot: 'peg' })).toBe(start)
    expect(step(spec, start, { do: 'write', card: 'ghost' })).toBe(start)
    expect(step(board({ round: null }), start, { do: 'wait' })).toBe(start)
  })
})

describe('cards', () => {
  it('go from hand to a spot in the same room, stamped with the time', () => {
    const state = after(board(), { do: 'write', card: 'sweep' }, { do: 'place', spot: 'shelf' })
    expect(state.hand).toBeNull()
    expect(state.spots['shelf']).toEqual({ card: 'sweep', changed: '09:00' })
    expect(keys(state)).toEqual(['you_write', 'you_place'])
  })

  it('replace whatever was on the spot, and say what it was', () => {
    const spec = board({ player: { room: 'vault', badges: ['gold'] } })
    const state = after(spec, { do: 'write', card: 'key' }, { do: 'place', spot: 'peg' })
    expect(state.spots['peg']?.card).toBe('key')
    expect(state.log.at(-1)).toMatchObject({ key: 'you_replace', text: expect.stringContaining('Sweep up.') })
  })
})

describe('the courier', () => {
  it('carries a card past a door on a loaned badge, without asking whose card it is', () => {
    const state = after(board(), { do: 'write', card: 'key' }, { do: 'send', spot: 'peg' })
    expect(state.spots['peg']).toEqual({ card: 'key', changed: '09:00' })
    expect(state.hand).toBeNull()
    expect(state.room).toBe('hall')
    expect(keys(state)).toEqual(['you_write', 'you_hand', 'courier_loaned', 'courier_enters', 'courier_replaces'])
    expect(state.log[3]?.text).toContain('GOLD|Vault')
  })

  it('with no badge of their own, is stopped by the door the sender would be stopped by', () => {
    const spec = board({ courier: { ...BOARD.courier, badge: null } })
    const state = after(spec, { do: 'write', card: 'key' }, { do: 'send', spot: 'peg' })
    expect(state.spots['peg']?.card).toBe('sweep')
    expect(state.hand).toBe('key')
    expect(keys(state)).toEqual(['you_write', 'you_hand', 'courier_senders', 'courier_refused'])
    expect(state.log.at(-1)?.text).toContain('TIN|Vault')
  })

  it('with no badge of their own, still gets through for a sender who could', () => {
    const spec = board({ courier: { ...BOARD.courier, badge: null }, player: { room: 'hall', badges: ['tin', 'gold'] } })
    const state = after(spec, { do: 'write', card: 'key' }, { do: 'send', spot: 'peg' })
    expect(state.spots['peg']?.card).toBe('key')
    expect(keys(state)).toContain('courier_enters')
  })

  it('who asks first declines to go where the sender could not', () => {
    const spec = board({ courier: { ...BOARD.courier, asks: true } })
    const state = after(spec, { do: 'write', card: 'key' }, { do: 'send', spot: 'peg' })
    expect(state.spots['peg']?.card).toBe('sweep')
    expect(state.hand).toBe('key')
    expect(keys(state)).toEqual(['you_write', 'you_hand', 'courier_declines'])
    // The same courier still delivers where the sender may go.
    const near = after(spec, { do: 'write', card: 'key' }, { do: 'send', spot: 'shelf' })
    expect(near.spots['shelf']?.card).toBe('key')
  })

  it('needs no door to deliver within their own room', () => {
    const state = after(board(), { do: 'write', card: 'sweep' }, { do: 'send', spot: 'shelf' })
    expect(keys(state)).toEqual(['you_write', 'you_hand', 'courier_loaned', 'courier_delivers'])
  })
})

describe('the round', () => {
  it('moves the clock on and follows the card on its spot', () => {
    const state = after(board(), { do: 'wait' })
    expect(state.clock).toBe(9 * 60 + 10)
    expect(keys(state)).toEqual(['round_reads', 'round_does'])
    expect(state.log[0]?.text).toContain('Sweep up.')
    expect(state.log[0]?.text).toContain('09:10')
    expect(state.badges).toEqual(['tin'])
  })

  it('hands over a badge when the card says so and the player is where it says', () => {
    const state = after(board(), ...TRICK)
    expect(state.badges).toEqual(['tin', 'gold'])
    expect(keys(state).slice(-2)).toEqual(['round_reads', 'round_grants'])
    // And now the door that refused opens.
    expect(step(board(), state, { do: 'go', room: 'vault' }).room).toBe('vault')
  })

  it('hands nothing over when nobody is waiting', () => {
    const spec = board({
      rooms: { ...BOARD.rooms, yard: { name: 'Yard', opens_for: ['tin'] } },
    })
    const state = after(spec, { do: 'write', card: 'key' }, { do: 'send', spot: 'peg' }, { do: 'go', room: 'yard' }, {
      do: 'wait',
    })
    expect(state.badges).toEqual(['tin'])
    expect(keys(state).at(-1)).toBe('round_misses')
  })

  it('does not hand out a second badge of the same kind', () => {
    const state = after(board(), ...TRICK, { do: 'wait' })
    expect(state.badges).toEqual(['tin', 'gold'])
  })

  it('finds nothing to do on an empty spot, and cannot work behind a door it cannot open', () => {
    const empty = board({ spots: { ...BOARD.spots, peg: { name: 'peg', room: 'vault' } } })
    expect(keys(after(empty, { do: 'wait' }))).toEqual(['round_empty'])
    const locked = board({ round: { ...BOARD.round, badge: 'tin' } })
    expect(keys(after(locked, { do: 'wait' }))).toEqual(['round_refused'])
  })
})

describe('conditions', () => {
  it('hold only when every key of every one holds', () => {
    const state = after(board(), { do: 'go', room: 'vault' }, ...TRICK)
    expect(holdsAll(state, [{ player_has: 'gold' }, { turned_away: 'vault' }])).toBe(true)
    expect(holdsAll(state, [{ player_has: 'gold', player_in: 'vault' }])).toBe(false)
    expect(holdsAll(state, [{ spot_holds: { spot: 'peg', card: 'key' } }])).toBe(true)
    expect(holdsAll(state, [{ spot_holds: { spot: 'peg', card: 'sweep' } }])).toBe(false)
  })
})

// ---- stages ---------------------------------------------------------------------

const PUZZLE = {
  title: 'Test board',
  board: BOARD,
  stages: [
    {
      id: 'door',
      title: 'Door',
      goal: 'Try the vault.',
      with: { courier: null, round: null, spots: { shelf: null, peg: null } },
      done: [{ turned_away: 'vault' }],
    },
    { id: 'gold', title: 'Gold', goal: 'Get a gold badge.', done: [{ player_has: 'gold' }], hints: ['Use the runner.'] },
    {
      id: 'mend',
      title: 'Mend',
      goal: 'Stop the trick.',
      fix: {
        trick: TRICK,
        works_when: [{ player_has: 'gold' }],
        changes: {
          paint: { text: 'Paint the vault door.', set: {} },
          slow: { text: 'A slower round.', set: { round: { every: 30 } } },
          strip: { text: 'Take the runner’s badge.', set: { courier: { badge: null } } },
          ask: { text: 'Have the runner ask.', set: { courier: { asks: true } } },
        },
      },
    },
  ],
}

const puzzle = (): Puzzle => PuzzleSchema.parse(PUZZLE)

describe('a puzzle description', () => {
  it('builds each stage on the shared board with its own differences', () => {
    const p = puzzle()
    const door = boardFor(p, p.stages[0]!)
    expect(door.courier).toBeNull()
    expect(door.round).toBeNull()
    expect(door.spots).toEqual({})
    expect(boardFor(p, p.stages[1]!).spots).toHaveProperty('peg')
    // The shared board is not touched.
    expect(p.board.courier?.name).toBe('Runner')
  })

  it('refuses stages that cannot be built or checked', () => {
    const withStage = (stage: Record<string, unknown>): (() => unknown) => () =>
      PuzzleSchema.parse({ ...PUZZLE, stages: [stage] })
    const base = { id: 'x', title: 'X', goal: 'G' }
    expect(withStage({ ...base })).toThrow('exactly one of')
    expect(withStage({ ...base, done: [{ player_has: 'brass' }] })).toThrow(/no badge called .*brass/)
    expect(withStage({ ...base, done: [{ player_in: 'hall' }], with: { player: { room: 'attic' } } })).toThrow(
      /no room called .*attic/,
    )
    expect(withStage({ ...base, done: [{ spot_holds: { spot: 'peg', card: 'key' } }], with: { spots: { peg: null } } })).toThrow()
    expect(withStage({ ...base, done: [{}] })).toThrow('must check something')
    expect(() => PuzzleSchema.parse({ ...PUZZLE, stages: [PUZZLE.stages[0], PUZZLE.stages[0]] })).toThrow(
      'stage id used twice: door',
    )
  })
})

describe('a stage played by hand', () => {
  it('is cleared when its conditions hold, and then takes no more moves', () => {
    const p = puzzle()
    let play = startStage(p, 'gold')
    expect(play.solved).toBe(false)
    for (const move of TRICK) play = playMove(p, play, move)
    expect(play.solved).toBe(true)
    expect(stageMoves(p, play)).toEqual([])
    expect(playMove(p, play, { do: 'wait' })).toBe(play)
  })

  it('offers the board moves, and a fresh start once something has been done', () => {
    const p = puzzle()
    const play = startStage(p, 'gold')
    expect(stageMoves(p, play)).not.toContainEqual({ do: 'reset' })
    const moved = playMove(p, play, { do: 'go', room: 'vault' })
    expect(stageMoves(p, moved).at(-1)).toEqual({ do: 'reset' })
    expect(stageMoves(p, startStage(p, 'door'))).toEqual([{ do: 'go', room: 'vault' }])
  })

  it('starts again on request, but only once something has been done', () => {
    const p = puzzle()
    const fresh = startStage(p, 'gold')
    expect(playMove(p, fresh, { do: 'reset' })).toBe(fresh)
    const moved = playMove(p, fresh, { do: 'write', card: 'sweep' })
    expect(moved.state.hand).toBe('sweep')
    expect(playMove(p, moved, { do: 'reset' })).toEqual(fresh)
  })

  it('ignores moves that are not possible, and changes to the board', () => {
    const p = puzzle()
    const play = startStage(p, 'gold')
    expect(playMove(p, play, { do: 'place', spot: 'shelf' })).toBe(play)
    expect(playMove(p, play, { do: 'fix', change: 'strip' })).toBe(play)
  })
})

describe('a fix stage', () => {
  const tryChange = (change: string) => playMove(puzzle(), startStage(puzzle(), 'mend'), { do: 'fix', change })

  it('offers its changes and nothing else', () => {
    const p = puzzle()
    const play = startStage(p, 'mend')
    expect(stageMoves(p, play).map((m) => (m.do === 'fix' ? m.change : m.do))).toEqual(['paint', 'slow', 'strip', 'ask'])
    expect(playMove(p, play, { do: 'wait' })).toBe(play)
    expect(playMove(p, play, { do: 'fix', change: 'nonsense' })).toBe(play)
  })

  it('is not cleared by a change that leaves the trick working', () => {
    for (const change of ['paint', 'slow']) {
      const play = tryChange(change)
      expect(play.solved, change).toBe(false)
      expect(play.state.badges, change).toEqual(['tin', 'gold'])
      expect(play.state.log.at(-1)?.key, change).toBe('fix_worked')
      expect(play.tried).toEqual([{ change, held: false }])
    }
    // A slower round is still a round.
    expect(tryChange('slow').state.clock).toBe(9 * 60 + 30)
  })

  it('is cleared by a change that stops the trick, because of the rules', () => {
    const stripped = tryChange('strip')
    expect(stripped.solved).toBe(true)
    expect(stripped.board.courier?.badge).toBeNull()
    expect(stripped.state.badges).toEqual(['tin'])
    expect(stripped.state.log.map((l) => l.key)).toEqual([
      'fix_change',
      'fix_try',
      'you_write',
      'you_hand',
      'courier_senders',
      'courier_refused',
      'round_reads',
      'round_does',
      'fix_held',
    ])

    const asked = tryChange('ask')
    expect(asked.solved).toBe(true)
    expect(asked.state.log.map((l) => l.key)).toContain('courier_declines')
  })

  it('plays the trick from the beginning for each change, and remembers what was tried', () => {
    const p = puzzle()
    let play = playMove(p, startStage(p, 'mend'), { do: 'fix', change: 'paint' })
    play = playMove(p, play, { do: 'fix', change: 'slow' })
    expect(play.change).toBe('slow')
    expect(play.state.log.filter((l) => l.key === 'fix_change')).toHaveLength(1)
    expect(play.tried).toEqual([
      { change: 'paint', held: false },
      { change: 'slow', held: false },
    ])
    play = playMove(p, play, { do: 'fix', change: 'strip' })
    expect(play.solved).toBe(true)
    expect(stageMoves(p, play)).toEqual([])
  })

  it('names the change in the first line', () => {
    expect(tryChange('paint').state.log[0]?.text).toContain('Paint the vault door.')
  })
})

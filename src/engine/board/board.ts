// The rules of a board puzzle. Everything here is a pure function of the
// board, its state and a move: same inputs, same result.
//
// There are no flags saying which moves win. A door opens when whoever is
// standing at it holds a badge it opens for, and for no other reason. A trick
// works on one board and fails on another because the boards differ.

import {
  boardFor,
  type BoardSpec,
  type Condition,
  type LineKey,
  type Move,
  type Puzzle,
  type Stage,
} from './schema.ts'

/** One thing that happened, in words. */
export interface BoardLine {
  key: LineKey
  text: string
}

export interface BoardState {
  /** The room the player is in. */
  room: string
  /** The player's badges, oldest first. */
  badges: readonly string[]
  /** The kind of card in the player's hand, if any. */
  hand: string | null
  /** What is on each spot, and what the clock read when it was last changed. */
  spots: Readonly<Record<string, { card: string | null; changed: string | null }>>
  /** Minutes since midnight. */
  clock: number
  /** Rooms whose door has refused the player. */
  turnedAway: readonly string[]
  /** Covered spots the player has looked at, and so knows the contents of. */
  seen: readonly string[]
  log: readonly BoardLine[]
}

/** A move on the board itself, as opposed to a change to the board or a restart. */
export type BoardMove = Exclude<Move, { do: 'fix' } | { do: 'reset' }>

const two = (n: number): string => String(n).padStart(2, '0')

/** One of the board's sentences, with its {placeholders} filled in. */
function written(board: BoardSpec, key: LineKey, values: Record<string, string> = {}): BoardLine {
  const template = board.lines[key]
  // A board's description is checked for every sentence it could print.
  if (template === undefined) throw new Error(`the board has no line written for "${key}"`)
  return { key, text: template.replace(/\{([a-z_]+)\}/g, (whole, name: string) => values[name] ?? whole) }
}

/** Minutes since midnight as hh:mm. */
export function clockText(minutes: number): string {
  const inDay = ((minutes % 1440) + 1440) % 1440
  return `${two(Math.floor(inDay / 60))}:${two(inDay % 60)}`
}

export function initialState(board: BoardSpec): BoardState {
  const [hours, minutes] = board.start.split(':').map(Number)
  return {
    room: board.player.room,
    badges: [...board.player.badges],
    hand: null,
    spots: Object.fromEntries(
      Object.entries(board.spots).map(([id, spot]) => [id, { card: spot.holds, changed: spot.changed }]),
    ),
    clock: hours! * 60 + minutes!,
    turnedAway: [],
    seen: [],
    log: [],
  }
}

/** The moves open to the player, in the order a board would offer them. */
export function legalMoves(board: BoardSpec, state: BoardState): BoardMove[] {
  const moves: BoardMove[] = []
  for (const room of Object.keys(board.rooms)) {
    if (room !== state.room) moves.push({ do: 'go', room })
  }
  // Looking is for what cannot be read from across the board, and only once.
  for (const [id, spot] of Object.entries(board.spots)) {
    const looked = state.seen.includes(id)
    if (spot.covered && spot.room === state.room && state.spots[id]!.card !== null && !looked) {
      moves.push({ do: 'read', spot: id })
    }
  }
  // A card is only worth writing when there is somewhere for a card to go.
  if (Object.keys(board.spots).length > 0) {
    for (const [id, card] of Object.entries(board.cards)) if (!card.found) moves.push({ do: 'write', card: id })
  }
  if (state.hand !== null) {
    for (const [id, spot] of Object.entries(board.spots)) {
      if (spot.room === state.room) moves.push({ do: 'place', spot: id })
    }
    if (board.courier && board.courier.room === state.room) {
      for (const id of Object.keys(board.spots)) moves.push({ do: 'send', spot: id })
    }
  }
  if (board.round) moves.push({ do: 'wait' })
  return moves
}

function sameMove(a: BoardMove, b: BoardMove): boolean {
  if (a.do !== b.do) return false
  if (a.do === 'go' && b.do === 'go') return a.room === b.room
  if (a.do === 'write' && b.do === 'write') return a.card === b.card
  if (a.do === 'read' && b.do === 'read') return a.spot === b.spot
  if ((a.do === 'place' && b.do === 'place') || (a.do === 'send' && b.do === 'send')) return a.spot === b.spot
  return true
}

/**
 * Make one move. An impossible move (walking to the room you are in, handing
 * over a card you do not hold) changes nothing and returns the same state.
 */
export function step(board: BoardSpec, state: BoardState, move: BoardMove): BoardState {
  if (!legalMoves(board, state).some((legal) => sameMove(legal, move))) return state

  const log = [...state.log]
  const say = (key: LineKey, values: Record<string, string> = {}): void => {
    log.push(written(board, key, values))
  }
  const badgeName = (id: string): string => board.badges[id] ?? id
  /** The badge among these that opens a room, if any does. */
  const opener = (badges: readonly string[], room: string): string | undefined =>
    badges.find((badge) => board.rooms[room]!.opens_for.includes(badge))
  /** The badge someone would show a reader: the one that works, or else their newest. */
  const shown = (badges: readonly string[], room: string): string =>
    badgeName(opener(badges, room) ?? badges[badges.length - 1]!)

  /** Put a card on a spot, giving back the text of any card it replaces. */
  let spots = state.spots
  let seen = state.seen
  const put = (spotId: string, card: string): string | null => {
    const old = spots[spotId]!.card
    spots = { ...spots, [spotId]: { card, changed: clockText(state.clock) } }
    // What is there now is not what was looked at before.
    seen = seen.filter((id) => id !== spotId)
    return old === null ? null : board.cards[old]!.text
  }

  if (move.do === 'go') {
    const room = board.rooms[move.room]!
    const values = { badge: shown(state.badges, move.room), room: room.name }
    if (opener(state.badges, move.room) === undefined) {
      say('you_refused', values)
      const turnedAway = state.turnedAway.includes(move.room) ? state.turnedAway : [...state.turnedAway, move.room]
      return { ...state, turnedAway, log }
    }
    say('you_enter', values)
    return { ...state, room: move.room, log }
  }

  if (move.do === 'read') {
    const spot = board.spots[move.spot]!
    const card = board.cards[state.spots[move.spot]!.card!]!
    say('you_read', { spot: spot.name, room: board.rooms[spot.room]!.name, card: card.text })
    // A code that has been read is held from then on, like any badge.
    let badges = state.badges
    if (card.tells !== undefined && !badges.includes(card.tells)) {
      badges = [...badges, card.tells]
      say('you_learn', { badge: badgeName(card.tells) })
    }
    return { ...state, badges, seen: [...state.seen, move.spot], log }
  }

  if (move.do === 'write') {
    say('you_write', { card: board.cards[move.card]!.text })
    return { ...state, hand: move.card, log }
  }

  if (move.do === 'place') {
    const spot = board.spots[move.spot]!
    const old = put(move.spot, state.hand!)
    const values = { spot: spot.name, room: board.rooms[spot.room]!.name }
    if (old === null) say('you_place', values)
    else say('you_replace', { ...values, old })
    return { ...state, hand: null, spots, seen, log }
  }

  if (move.do === 'send') {
    const courier = board.courier!
    const spot = board.spots[move.spot]!
    const room = board.rooms[spot.room]!
    const names = { courier: courier.name, spot: spot.name, room: room.name }
    say('you_hand', names)

    // A careful courier will not go where the sender could not have gone.
    if (courier.asks && opener(state.badges, spot.room) === undefined) {
      say('courier_declines', { ...names, badge: shown(state.badges, spot.room) })
      return { ...state, log }
    }

    // The door reads whatever badge the courier is wearing: their own if they
    // have been lent one, and otherwise the sender's.
    const wearing = courier.badge !== null ? [courier.badge] : state.badges
    const badge = shown(wearing, spot.room)
    say(courier.badge !== null ? 'courier_loaned' : 'courier_senders', { ...names, badge })
    if (spot.room !== courier.room) {
      if (opener(wearing, spot.room) === undefined) {
        say('courier_refused', { ...names, badge })
        return { ...state, log }
      }
      say('courier_enters', { ...names, badge })
    }
    const old = put(move.spot, state.hand!)
    if (old === null) say('courier_delivers', names)
    else say('courier_replaces', { ...names, old })
    return { ...state, hand: null, spots, seen, log }
  }

  // Wait: the clock runs on to the next round, and the round is made.
  const round = board.round!
  const clock = state.clock + round.every
  const spot = board.spots[round.reads]!
  const room = board.rooms[spot.room]!
  const names = { time: clockText(clock), round: round.name, spot: spot.name, room: room.name }
  if (!room.opens_for.includes(round.badge)) {
    say('round_refused', names)
    return { ...state, clock, log }
  }
  const kind = state.spots[round.reads]!.card
  if (kind === null) {
    say('round_empty', names)
    return { ...state, clock, log }
  }
  const card = board.cards[kind]!
  say('round_reads', { ...names, card: card.text })
  if (!card.grants) {
    say('round_does', names)
    return { ...state, clock, log }
  }
  const granted = { round: round.name, badge: badgeName(card.grants.badge), room: board.rooms[card.grants.in]!.name }
  if (state.room !== card.grants.in) {
    say('round_misses', granted)
    return { ...state, clock, log }
  }
  say('round_grants', granted)
  const badges = state.badges.includes(card.grants.badge) ? state.badges : [...state.badges, card.grants.badge]
  return { ...state, clock, badges, log }
}

/** Do all of these hold on the board as it stands? */
export function holdsAll(state: BoardState, conditions: readonly Condition[]): boolean {
  return conditions.every((c) => {
    if (c.player_in !== undefined && state.room !== c.player_in) return false
    if (c.player_has !== undefined && !state.badges.includes(c.player_has)) return false
    if (c.turned_away !== undefined && !state.turnedAway.includes(c.turned_away)) return false
    if (c.spot_holds !== undefined && state.spots[c.spot_holds.spot]?.card !== c.spot_holds.card) return false
    return true
  })
}

// ---- a stage in play -------------------------------------------------------------

/** One stage of a puzzle, as far as the player has got with it. */
export interface StagePlay {
  stage: string
  /** The board as it stands, including any change made in a fix stage. */
  board: BoardSpec
  state: BoardState
  solved: boolean
  /** Fix stages: the change now in place, and every change tried with how it went. */
  change: string | null
  tried: readonly { change: string; held: boolean }[]
}

function stageOf(puzzle: Puzzle, id: string): Stage {
  const stage = puzzle.stages.find((s) => s.id === id)
  if (!stage) throw new Error(`no puzzle stage called "${id}"`)
  return stage
}

export function startStage(puzzle: Puzzle, stageId: string): StagePlay {
  const board = boardFor(puzzle, stageOf(puzzle, stageId))
  return { stage: stageId, board, state: initialState(board), solved: false, change: null, tried: [] }
}

/** The moves open to the player in a stage. A cleared stage has none. */
export function stageMoves(puzzle: Puzzle, play: StagePlay): Move[] {
  if (play.solved) return []
  const stage = stageOf(puzzle, play.stage)
  if (stage.fix) return Object.keys(stage.fix.changes).map((change) => ({ do: 'fix', change }))
  const moves: Move[] = legalMoves(play.board, play.state)
  // Starting again is only on offer once there is something to start again from.
  if (play.state.log.length > 0) moves.push({ do: 'reset' })
  return moves
}

/**
 * Make a move in a stage. Returns the same object when the move is not
 * possible, so the caller can tell that nothing happened.
 */
export function playMove(puzzle: Puzzle, play: StagePlay, move: Move): StagePlay {
  if (play.solved) return play
  const stage = stageOf(puzzle, play.stage)

  if (stage.fix) {
    if (move.do !== 'fix' || !(move.change in stage.fix.changes)) return play
    // Make the change, then let the trick be played against the changed
    // board from the beginning. Whether it still works is up to the rules.
    const board = boardFor(puzzle, stage, move.change)
    const line = (key: LineKey, values: Record<string, string> = {}): BoardLine => written(board, key, values)
    let state = initialState(board)
    state = { ...state, log: [line('fix_change', { change: stage.fix.changes[move.change]!.text }), line('fix_try')] }
    for (const trickMove of stage.fix.trick) {
      if (trickMove.do !== 'fix' && trickMove.do !== 'reset') state = step(board, state, trickMove)
    }
    const held = !holdsAll(state, stage.fix.works_when)
    state = { ...state, log: [...state.log, line(held ? 'fix_held' : 'fix_worked')] }
    return {
      stage: play.stage,
      board,
      state,
      solved: held,
      change: move.change,
      tried: [...play.tried.filter((t) => t.change !== move.change), { change: move.change, held }],
    }
  }

  if (move.do === 'fix') return play
  if (move.do === 'reset') {
    // Nothing to start again from if nothing has been done.
    return play.state.log.length === 0 ? play : startStage(puzzle, play.stage)
  }
  const state = step(play.board, play.state, move)
  if (state === play.state) return play
  return { ...play, state, solved: holdsAll(state, stage.done!) }
}

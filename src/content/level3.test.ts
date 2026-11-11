import { beforeEach, describe, expect, it } from 'vitest'
import { playMove, startStage } from '../engine/board/board.ts'
import type { Move } from '../engine/board/schema.ts'
import { buildWorld, loadGame, type LoadedGame } from '../engine/levels/loader.ts'
import type { Answer } from '../engine/levels/logbook.ts'
import { LevelSession } from '../engine/levels/runner.ts'
import { programs } from '../engine/shell/commands/index.ts'
import { contentSource } from './index.ts'

// Level 3, Borrowed Authority: the whiteboard puzzle, the look at the real
// programs afterwards, and the logbook. Kept apart from the other levels'
// tests because most of it is played with moves, not typed lines.

let game: LoadedGame

function start(): LevelSession {
  return new LevelSession({
    loaded: game.levels[2]!,
    world: buildWorld(game, 2, programs),
    programs,
    tty: game.game.tty,
  })
}

const out = (session: LevelSession, line: string): string =>
  session
    .run(line)
    .output.map((c) => c.text)
    .join('')

/** What the guidance panel is showing: the command to type, the hoop in play, or the kind of beat. */
function showing(session: LevelSession): string {
  const beat = session.getState().beat
  if (!beat) return 'nothing'
  if ('prompt' in beat) return beat.prompt.run
  if ('log' in beat) return `log:${beat.log.entry}`
  if ('puzzle' in beat) return `hoop:${beat.puzzle.stage}`
  return Object.keys(beat)[0]!
}

/** One way through each hoop of the whiteboard puzzle. */
const HOOPS: Record<string, Move[]> = {
  doors: [{ do: 'go', room: 'control' }],
  courier: [
    { do: 'write', card: 'hello' },
    { do: 'send', spot: 'duty' },
  ],
  round: [{ do: 'write', card: 'badge' }, { do: 'send', spot: 'hook' }, { do: 'wait' }],
  tidy: [
    { do: 'go', room: 'control' },
    { do: 'write', card: 'boilers' },
    { do: 'place', spot: 'hook' },
  ],
  close: [{ do: 'fix', change: 'unbadge' }],
}

const SUGGESTED = ['ls -l /usr/local/bin/mvmail', 'ls -l /usr/lib/atrun']

/** The printout line that shows the mail helper being used. */
const HANDOVER = '02:19  granite$ mvmail /tmp/note /usr/lib/atrun'

const ANSWERS: Record<string, Answer> = {
  pieces: { kind: 'fill', values: { courier: 'mvmail', hook: 'atrun' } },
  bit: { kind: 'fill', values: { letter: 's', owner: 'root' } },
  conditions: { kind: 'choose', chosen: ['runs-as-root', 'no-check', 'system-runs'] },
  proof: { kind: 'pin', text: HANDOVER, source: 'printout:session' },
  fix: { kind: 'write', text: 'Take the setuid bit off mvmail.' },
}

/**
 * Play Level 3 towards its logbook: Continue past what is said, clear each
 * hoop with the moves given for it, and type what is suggested. Stops early
 * at a hoop that the moves given do not clear.
 */
function play(session: LevelSession, hoops: Record<string, Move[]> = HOOPS): void {
  session.begin()
  for (let guard = 0; guard < 100; guard++) {
    const beat = session.getState().beat
    if (!beat || 'log' in beat) return
    const before = showing(session)
    if ('say' in beat) session.continue()
    else if ('puzzle' in beat) for (const move of hoops[beat.puzzle.stage] ?? []) session.move(move)
    else if ('prompt' in beat) session.run(beat.prompt.run)
    if (!('say' in beat) && showing(session) === before) return
  }
  throw new Error('the level did not reach its logbook')
}

const boardLog = (session: LevelSession): string[] => session.getState().puzzle!.play.state.log.map((l) => l.text)
const met = (session: LevelSession, id: string): boolean =>
  session.getState().objectives.find((o) => o.id === id)!.met

beforeEach(() => {
  game = loadGame(contentSource)
})

describe('Level 3: the world', () => {
  it('starts the next morning, with last night in the login records', () => {
    const session = start()
    expect(out(session, 'date')).toBe('Wed Sep  3 08:20:00 PDT 1986\n')
    expect(out(session, 'last hollis')).toMatch(/^hollis\s+ttyn1\s+shale\s+Wed Sep  3 02:11 - 02:36/m)
    expect(out(session, 'last ops')).toMatch(/^ops\s+ttyh4\s+Tue Sep  2 13:10 - 17:20/m)
  })

  it('rests on facts that hold in the world', () => {
    const session = start()
    const fs = session.world.host('granite').fs

    // The mail helper belongs to root and carries the setuid bit.
    const helper = fs.inspect('/usr/local/bin/mvmail')!
    expect(helper.uid).toBe(0)
    expect(helper.mode & 0o7777).toBe(0o4711)

    // The job file is root's alone to write, and was last changed while hollis was logged in.
    const job = fs.inspect('/usr/lib/atrun')!
    expect(job.uid).toBe(0)
    expect(job.mode & 0o022).toBe(0)
    expect(out(session, 'ls -l /usr/lib/atrun')).toBe(
      '-rwxr-xr-x  1 root     wheel         29 Sep  3 02:27 /usr/lib/atrun\n',
    )
  })

  it('prints on paper the listings the terminal shows', () => {
    const session = start()
    const printout = session.loaded.tray.find((t) => t.id === 'session')!.text
    expect(printout).toContain(`02:13  ${out(session, 'ls -l /usr/local/bin/mvmail')}`)
    // The job file as it was before he touched it: the same line with its old date.
    expect(printout).toContain('02:14  -rwxr-xr-x  1 root     wheel         29 Nov 12  1984 /usr/lib/atrun\n')
    expect(printout).toContain('02:27  granite# cp /tmp/.keep /usr/lib/atrun\n')
    expect(printout).toContain(`${HANDOVER}\n`)
  })

  it('holds nothing that carries out the trick, and leaves the hole open', () => {
    const session = start()
    const fs = session.world.host('granite').fs
    const before = fs.peek('/usr/lib/atrun')

    // The helper only says how it is used, and cannot be read.
    expect(out(session, 'mvmail /etc/motd /usr/lib/atrun')).toBe('usage: mvmail inbox-file destination\n')
    expect(out(session, 'mvmail')).toBe('usage: mvmail inbox-file destination\n')
    expect(fs.peek('/usr/lib/atrun')).toBe(before)
    expect(out(session, 'cat /usr/local/bin/mvmail')).toContain('Permission denied')
    expect(out(session, 'whoami')).toBe('ops\n')

    // The player's account may not change root's file, so Marge's decision stands.
    expect(session.run('chmod u-s /usr/local/bin/mvmail').status).not.toBe(0)
    expect(fs.inspect('/usr/local/bin/mvmail')!.mode & 0o4000).toBe(0o4000)
  })
})

describe('Level 3: the whiteboard', () => {
  it('comes before anything is typed, one hoop at a time', () => {
    const session = start()
    session.begin()
    expect(session.getState().puzzle).toBeNull()
    session.continue()
    expect(showing(session)).toBe('hoop:doors')
    expect(session.getState().puzzle).toMatchObject({ title: 'The building at night', step: 'Hoop', number: 1, of: 5 })

    // Hoop 1 has doors and nothing else.
    expect(session.getState().puzzle!.moves).toEqual([
      { do: 'go', room: 'office' },
      { do: 'go', room: 'control' },
    ])
    session.move({ do: 'go', room: 'office' })
    expect(boardLog(session).at(-1)).toBe(
      'You hold your STAFF badge to the reader on the Office door. Green light. You walk in.',
    )
    expect(showing(session)).toBe('hoop:doors')
    session.move({ do: 'go', room: 'control' })
    expect(boardLog(session).at(-1)).toBe(
      'You hold your STAFF badge to the reader on the Control Room door. Red light. The door stays shut.',
    )
    expect(showing(session)).toBe('say')
  })

  it('lets the courier carry a card where the player cannot go', () => {
    const session = start()
    play(session, { doors: HOOPS['doors']! })
    expect(showing(session)).toBe('hoop:courier')
    // Only the one card to write, and no watchman yet.
    expect(session.getState().puzzle!.moves.filter((m) => m.do === 'write' || m.do === 'wait')).toEqual([
      { do: 'write', card: 'hello' },
    ])

    // Pinning it up in the Lobby is allowed, and is not the point.
    session.move({ do: 'write', card: 'hello' })
    session.move({ do: 'place', spot: 'notice' })
    session.move({ do: 'go', room: 'control' })
    expect(showing(session)).toBe('hoop:courier')

    session.move({ do: 'write', card: 'hello' })
    session.move({ do: 'send', spot: 'duty' })
    expect(boardLog(session).slice(-3)).toEqual([
      'Dot does not ask who you are. Her badge reads MASTER: the building lends it to her, so that the mail always gets through.',
      'The reader on the Control Room door sees MASTER. Green light. Dot walks in.',
      'Dot pins your card on the duty board.',
    ])
    expect(showing(session)).toBe('say')
  })

  it('gives up a MASTER badge only when the card is on the hook and the player is waiting', () => {
    const session = start()
    play(session, { doors: HOOPS['doors']!, courier: HOOPS['courier']! })
    expect(showing(session)).toBe('hoop:round')
    const badges = (): readonly string[] => session.getState().puzzle!.play.state.badges

    // An ordinary round.
    session.move({ do: 'wait' })
    expect(boardLog(session)).toEqual([
      '02:05. Walt makes his round and reads the card on the round hook: “Check the boilers.”',
      'Walt does what the card says, as he always does. Nothing changes for you.',
    ])

    // The right card in the wrong place: Walt never reads the duty board.
    session.move({ do: 'write', card: 'badge' })
    session.move({ do: 'send', spot: 'duty' })
    session.move({ do: 'wait' })
    expect(badges()).toEqual(['staff'])

    // The right card on the hook, but nobody in the Lobby.
    session.move({ do: 'write', card: 'badge' })
    session.move({ do: 'send', spot: 'hook' })
    session.move({ do: 'go', room: 'office' })
    session.move({ do: 'wait' })
    expect(boardLog(session).at(-1)).toContain('nobody is waiting in the Lobby')
    expect(badges()).toEqual(['staff'])
    expect(showing(session)).toBe('hoop:round')
    expect(met(session, 'trick')).toBe(false)

    session.move({ do: 'go', room: 'lobby' })
    session.move({ do: 'wait' })
    expect(boardLog(session).at(-1)).toBe(
      'Walt does what the card says, as he always does. He hands you a MASTER badge.',
    )
    expect(showing(session)).toBe('say')
    expect(met(session, 'trick')).toBe(true)
  })

  it('starts a hoop again on request', () => {
    const session = start()
    play(session, { doors: HOOPS['doors']!, courier: HOOPS['courier']! })
    session.move({ do: 'write', card: 'hello' })
    session.move({ do: 'send', spot: 'hook' })
    expect(session.getState().puzzle!.play.state.spots['hook']?.card).toBe('hello')
    session.move({ do: 'reset' })
    expect(session.getState().puzzle!.play.state).toMatchObject({ log: [], hand: null, clock: 120 })
    expect(session.getState().puzzle!.play.state.spots['hook']).toEqual({ card: 'boilers', changed: 'last March' })
  })

  it('can be tidied up by walking in or by courier, and the time on the hook changes either way', () => {
    const byCourier: Move[] = [
      { do: 'write', card: 'boilers' },
      { do: 'send', spot: 'hook' },
    ]
    for (const route of [HOOPS['tidy']!, byCourier]) {
      const session = start()
      play(session, { ...HOOPS, tidy: [] })
      expect(showing(session)).toBe('hoop:tidy')
      expect(session.getState().puzzle!.play.state.spots['hook']).toEqual({ card: 'badge', changed: '02:00' })
      for (const move of route) session.move(move)
      expect(showing(session)).toBe('say')
      expect(session.getState().puzzle!.play.state.spots['hook']).toEqual({ card: 'boilers', changed: '02:05' })
    }
  })

  it('closes the hole only with a change that stops the trick, because of the rules', () => {
    const puzzle = game.levels[2]!.level.puzzle!
    const close = puzzle.stages.find((s) => s.id === 'close')!

    // The trick that is tried is the very one that clears the hoop it comes from.
    let round = startStage(puzzle, 'round')
    for (const move of close.fix!.trick) round = playMove(puzzle, round, move)
    expect(round.solved).toBe(true)

    // No change is marked right or wrong in the level file. Each is tried.
    const held = Object.keys(close.fix!.changes).map((change) => {
      const result = playMove(puzzle, startStage(puzzle, 'close'), { do: 'fix', change })
      return [change, result.solved] as const
    })
    expect(held).toEqual([
      ['lock', false],
      ['slower', false],
      ['unbadge', true],
      ['ask', true],
    ])
  })

  it('shows the same trick bouncing off the changed building', () => {
    const session = start()
    play(session, { ...HOOPS, close: [] })
    expect(showing(session)).toBe('hoop:close')

    session.move({ do: 'fix', change: 'lock' })
    expect(boardLog(session).at(-1)).toBe('RESULT: the trick still works. That change did not close the hole.')
    session.move({ do: 'fix', change: 'slower' })
    expect(boardLog(session).join('\n')).toContain('02:10. Walt makes his round')
    expect(showing(session)).toBe('hoop:close')
    expect(met(session, 'closed')).toBe(false)

    session.move({ do: 'fix', change: 'ask' })
    expect(boardLog(session)).toEqual([
      'CHANGE: Dot keeps her badge, but first checks that the sender could have walked there.',
      'The same trick is tried again, move for move.',
      'You write a card: “Give a MASTER badge to whoever is waiting in the Lobby.”',
      'You hand your card to Dot: “For the round hook in the Control Room, please.”',
      'Dot looks at your badge first. “STAFF does not open the Control Room. I only take a card where its sender could have walked.” You get your card back.',
      '02:05. Walt makes his round and reads the card on the round hook: “Check the boilers.”',
      'Walt does what the card says, as he always does. Nothing changes for you.',
      'RESULT: the trick fails. The hole is closed.',
    ])
    expect(showing(session)).toBe('say')
    expect(met(session, 'closed')).toBe(true)
  })

  it('stops the trick at the door when the loaned badge is taken away', () => {
    const session = start()
    play(session, { ...HOOPS, close: [] })
    session.move({ do: 'fix', change: 'unbadge' })
    expect(boardLog(session).slice(4, 6)).toEqual([
      'Dot has no badge of her own now, so she takes yours along: STAFF.',
      'The reader on the Control Room door sees STAFF. Red light. Dot brings your card back.',
    ])
    expect(session.getState().puzzle!.play.board.courier).toMatchObject({ badge: null })
  })
})

describe('Level 3: the real names', () => {
  it('brings the printout only after the puzzle, then suggests each command in turn', () => {
    const session = start()
    play(session, { ...HOOPS, close: [] })
    expect(session.getState().tray).toEqual([])
    session.move({ do: 'fix', change: 'unbadge' })
    session.continue()
    expect(session.getState().tray.map((t) => t.id)).toEqual(['session'])
    session.continue()

    const typed: string[] = []
    for (let beat = session.getState().beat; beat && 'prompt' in beat; beat = session.getState().beat) {
      typed.push(beat.prompt.run)
      const record = session.run(beat.prompt.run)
      expect(record.output.filter((c) => c.stream === 'err'), beat.prompt.run).toEqual([])
    }
    expect(typed).toEqual(SUGGESTED)
    expect(showing(session)).toBe('log:pieces')
    expect(session.getState().objectives.filter((o) => !o.met)).toEqual([])
  })

  it('accepts other ways of looking at the two programs', () => {
    const session = start()
    session.begin()
    for (let guard = 0; guard < 40 && showing(session) !== SUGGESTED[0]; guard++) {
      const beat = session.getState().beat!
      if ('puzzle' in beat) for (const move of HOOPS[beat.puzzle.stage]!) session.move(move)
      else session.continue()
    }
    session.run('ls /usr/local/bin')
    expect(showing(session)).toBe(SUGGESTED[0])
    session.run('cd /usr/local/bin; ls -l')
    expect(showing(session)).toBe(SUGGESTED[1])
    session.run('ls -l /usr/lib | grep atrun')
    expect(showing(session)).toBe('log:pieces')
  })

  it('can be played from briefing to debrief', () => {
    const session = start()
    expect(session.getState().phase).toBe('brief')
    play(session)
    expect(showing(session)).toBe('log:pieces')
    for (const [entry, answer] of Object.entries(ANSWERS)) session.answer(entry, answer)
    expect(showing(session)).toBe('say')
    expect(session.getState().complete).toBe(false)
    session.continue()

    const state = session.getState()
    expect(state.objectives.filter((o) => !o.met)).toEqual([])
    expect(state.logbook.every((e) => e.complete)).toBe(true)
    expect(state.phase).toBe('debrief')
    expect(session.loaded.card.title).toBe('Borrowed authority')
  })

  it('marks the logbook by what was understood, in whatever form it is written', () => {
    const session = start()
    play(session)

    const swapped = session.answer('pieces', { kind: 'fill', values: { courier: 'atrun', hook: 'mvmail' } })
    expect(swapped.blanks).toEqual({ courier: false, hook: false })
    expect(
      session.answer('pieces', { kind: 'fill', values: { courier: '/usr/local/bin/mvmail', hook: 'ATRUN' } }).correct,
    ).toBe(true)

    expect(session.answer('bit', { kind: 'fill', values: { letter: 'x', owner: 'root' } }).blanks).toEqual({
      letter: false,
      owner: true,
    })
    expect(session.answer('bit', { kind: 'fill', values: { letter: 'S', owner: 'root' } }).correct).toBe(true)

    // He never had a password, an open file, or an administrator's account.
    const wrong = session.answer('conditions', { kind: 'choose', chosen: ['runs-as-root', 'no-check', 'knew-password'] })
    expect(wrong).toMatchObject({ correct: false, hint: expect.stringContaining('Nobody told him a password') })
    expect(
      session.answer('conditions', { kind: 'choose', chosen: ['system-runs', 'runs-as-root', 'no-check'] }).correct,
    ).toBe(true)

    // The proof is the handover: not the listing, and not what came after.
    const pin = (text: string): boolean =>
      session.answer('proof', { kind: 'pin', text, source: 'printout:session' }).correct
    expect(pin('02:25  root')).toBe(false)
    expect(pin('02:13  granite$ ls -l /usr/local/bin/mvmail')).toBe(false)
    expect(pin('02:27  granite# cp /tmp/.keep /usr/lib/atrun')).toBe(false)
    expect(pin(HANDOVER)).toBe(true)
  })

  it('accepts the fix in the words of the computer or of the building', () => {
    const fix = (text: string): boolean => {
      const session = start()
      play(session)
      for (const entry of ['pieces', 'bit', 'conditions', 'proof']) session.answer(entry, ANSWERS[entry]!)
      expect(showing(session)).toBe('log:fix')
      return session.answer('fix', { kind: 'write', text }).correct
    }
    expect(fix('Remove the s bit from mvmail')).toBe(true)
    expect(fix('chmod u-s on the mail helper')).toBe(true)
    expect(fix('Take the borrowed badge away from Dot.')).toBe(true)
    expect(fix('Make mvmail check that the person is allowed to write there')).toBe(true)
    expect(fix('Delete the hollis account')).toBe(false)
    expect(fix('Change the root password')).toBe(false)
  })

  it('rebuilds the same level from its recorded events', () => {
    const session = start()
    play(session, { ...HOOPS, close: [{ do: 'fix', change: 'lock' }] })
    expect(showing(session)).toBe('hoop:close')

    const replay = start()
    for (const event of session.events) replay.apply(event)
    expect(replay.getState()).toEqual(session.getState())
    expect(replay.getState().puzzle!.play.tried).toEqual([{ change: 'lock', held: false }])
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { playMove, startStage } from '../engine/board/board.ts'
import type { Move } from '../engine/board/schema.ts'
import { buildWorld, loadGame, type LoadedGame } from '../engine/levels/loader.ts'
import type { Answer } from '../engine/levels/logbook.ts'
import { LevelSession } from '../engine/levels/runner.ts'
import { programs } from '../engine/shell/commands/index.ts'
import { ROOT } from '../engine/vfs/index.ts'
import { contentSource } from './index.ts'

// Level 4, Passwords in the Clear: the whiteboard puzzle about notes left
// lying about, the search of the lab's own files, and the logbook. The first
// scaffolded level: each step has a goal, and a ladder of hints behind it.

let game: LoadedGame

function start(): LevelSession {
  return new LevelSession({
    loaded: game.levels[3]!,
    world: buildWorld(game, 3, programs),
    programs,
    tty: game.game.tty,
  })
}

const out = (session: LevelSession, line: string): string =>
  session
    .run(line)
    .output.map((c) => c.text)
    .join('')

/** What the guidance panel is about: the command behind the hints, the hoop in play, or the kind of beat. */
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
  letter: [
    { do: 'go', room: 'mail' },
    { do: 'read', spot: 'pigeon' },
    { do: 'go', room: 'annex' },
  ],
  chain: [
    { do: 'go', room: 'annex' },
    { do: 'read', spot: 'folder' },
    { do: 'go', room: 'vault' },
  ],
  close: [{ do: 'fix', change: 'rotate' }],
}

/** The command behind the last hint of each step, in order. */
const SUGGESTED = [
  'grep -i -l password /home/*/*',
  'ls -l /home/jquill/mbox /home/tnakata/mbox',
  'cat /home/jquill/mbox',
  'cat /home/rvoss/getlog',
  'grep -i password /home/*/*',
]

/** The printout line where his search begins. */
const SEARCH = '01:41  granite$ grep -i -l password /home/*/*'

const ANSWERS: Record<string, Answer> = {
  count: { kind: 'fill', values: { hits: '5', real: '3' } },
  exposed: { kind: 'choose', chosen: ['mbox', 'getlog', 'notes'] },
  shut: { kind: 'fill', values: { account: 'tnakata', root: 'root' } },
  proof: { kind: 'pin', text: SEARCH, source: 'printout:sweep' },
  fix: { kind: 'write', text: 'Change all three passwords and take them out of the files.' },
}

/**
 * Play Level 4 towards its logbook: Continue past what is said, clear each
 * hoop with the moves given for it, and type one of `lines` at each step.
 * Stops early at a hoop or a step that what was given does not clear.
 */
function play(
  session: LevelSession,
  lines: readonly string[] = SUGGESTED,
  hoops: Record<string, Move[]> = HOOPS,
): void {
  session.begin()
  let next = 0
  for (let guard = 0; guard < 100; guard++) {
    const beat = session.getState().beat
    if (!beat || 'log' in beat) return
    const before = showing(session)
    if ('say' in beat) session.continue()
    else if ('puzzle' in beat) for (const move of hoops[beat.puzzle.stage] ?? []) session.move(move)
    else if ('prompt' in beat) {
      const line = lines[next++]
      if (line === undefined) return
      session.run(line)
    }
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

describe('Level 4: the world', () => {
  it('starts the morning after, with last night in the login records', () => {
    const session = start()
    expect(out(session, 'date')).toBe('Thu Sep  4 08:30:00 PDT 1986\n')
    expect(out(session, 'last hollis')).toMatch(/^hollis\s+ttyn1\s+shale\s+Thu Sep  4 01:38 - 02:04/m)
    expect(out(session, 'last ops')).toMatch(/^ops\s+ttyh4\s+Wed Sep  3 08:20 - 17:05/m)
  })

  it('rests on facts that hold in the world', () => {
    const session = start()
    const fs = session.world.host('granite').fs
    const others = (path: string): number => fs.inspect(path)!.mode & 0o077

    // Five files that any account may read mention the word. Three give a login away.
    const open = ['dmbeki/todo', 'jquill/mbox', 'lfaber/memo', 'osato/notes', 'rvoss/getlog']
    for (const file of open) {
      expect(others(`/home/${file}`), file).toBe(0o044)
      expect(fs.peek(`/home/${file}`), file).toMatch(/password/i)
    }
    expect(fs.peek('/home/jquill/mbox')).toMatch(/Login:\s+jquill\n\s+Password:\s+magnet7/)
    expect(fs.peek('/home/rvoss/getlog')).toContain('user cryo coldfinger')
    expect(fs.peek('/home/osato/notes')).toContain('flint password is prism44, login OPTICS')
    expect(fs.peek('/home/dmbeki/todo')).not.toMatch(/magnet7|coldfinger|prism44/)
    expect(fs.peek('/home/lfaber/memo')).not.toMatch(/magnet7|coldfinger|prism44/)

    // A fourth is closed to ordinary accounts, and open to root.
    expect(others('/home/tnakata/mbox')).toBe(0)
    expect(out(session, 'cat /home/tnakata/mbox')).toBe('cat: /home/tnakata/mbox: Permission denied\n')
    expect(fs.readFile('/home/tnakata/mbox', ROOT)).toMatch(/Password:\s+muon-22/)

    // Nothing else under /home uses the word, so the count is the count.
    const everything = out(session, 'cat /home/*/*')
    expect(everything.match(/password/gi)).toHaveLength(5)

    // Every file with a password in it was there before he first called, on 21 August.
    const firstCall = Date.UTC(1986, 7, 21, 2, 14) / 1000
    for (const file of ['jquill/mbox', 'rvoss/getlog', 'osato/notes', 'tnakata/mbox']) {
      expect(fs.inspect(`/home/${file}`)!.mtime, file).toBeLessThan(firstCall)
    }
  })

  it('finds only what minds no capitals, and only what the account may open', () => {
    const session = start()
    expect(out(session, 'grep -i -l password /home/*/*')).toBe(
      [
        'grep: /home/tnakata/mbox: Permission denied',
        '/home/dmbeki/todo',
        '/home/jquill/mbox',
        '/home/lfaber/memo',
        '/home/osato/notes',
        '/home/rvoss/getlog',
        '',
      ].join('\n'),
    )
    // Without -i the letter that says "Password:" is missed.
    expect(out(session, 'grep -l password /home/*/*')).not.toContain('jquill')
    // The line that matches in the command file is not the line with the secret.
    expect(out(session, 'grep -i password /home/rvoss/getlog')).not.toContain('coldfinger')
  })

  it('prints on paper what the terminal shows', () => {
    const session = start()
    const printout = session.loaded.tray.find((t) => t.id === 'sweep')!.text
    /** A command and its output as the line monitor would print them at a given minute. */
    const onPaper = (time: string, line: string): string =>
      [`granite$ ${line}`, ...out(session, line).trimEnd().split('\n')]
        .map((text) => `${time}  ${text}`.trimEnd())
        .join('\n')

    // He is an ordinary account, like the player's, so he sees what the player sees.
    for (const [time, line] of [
      ['01:41', 'grep -i -l password /home/*/*'],
      ['01:43', 'grep -i password /home/jquill/mbox'],
      ['01:45', 'cat /home/rvoss/getlog'],
      ['01:48', 'grep -i password /home/osato/notes'],
      ['01:50', 'grep -i password /home/dmbeki/todo /home/lfaber/memo'],
    ] as const) {
      expect(printout, line).toContain(`${onPaper(time, line)}\n`)
    }
    expect(printout).toContain(`${SEARCH}\n`)
    expect(printout).toContain('Last login: Wed Sep  3 02:11 on ttyn1 from shale')
    expect(out(session, 'wc -l /etc/passwd')).toMatch(/^\s*11 /)
    expect(printout).toContain('[11 lines not printed here')
    // He never became root this time.
    expect(printout).not.toContain('granite#')
  })

  it('holds nothing that connects anywhere, and lets the player change none of it', () => {
    const session = start()
    const fs = session.world.host('granite').fs
    expect(programs.has('ftp')).toBe(false)
    expect(session.run('sh /home/rvoss/getlog').status).not.toBe(0)
    expect(out(session, 'ftp -n flint')).toMatch(/ftp/)
    expect(session.world.has('flint')).toBe(false)
    expect(session.world.has('basalt')).toBe(false)

    const before = fs.peek('/home/jquill/mbox')
    expect(out(session, 'rm /home/jquill/mbox')).toContain('Permission denied')
    expect(out(session, 'chmod 600 /home/jquill/mbox')).not.toBe('')
    expect(fs.peek('/home/jquill/mbox')).toBe(before)
    expect(fs.inspect('/home/jquill/mbox')!.mode & 0o777).toBe(0o644)
  })
})

describe('Level 4: the whiteboard', () => {
  it('comes before anything is typed, and has no clock, courier or cards to write', () => {
    const session = start()
    session.begin()
    session.continue()
    expect(showing(session)).toBe('hoop:letter')
    const view = session.getState().puzzle!
    expect(view).toMatchObject({ title: 'The building by day', step: 'Hoop', number: 1, of: 3 })
    expect(view.play.board).toMatchObject({ courier: null, round: null })
    expect(Object.keys(view.play.board.rooms)).toEqual(['lobby', 'office', 'mail', 'annex'])
    expect(view.moves).toEqual([
      { do: 'go', room: 'office' },
      { do: 'go', room: 'mail' },
      { do: 'go', room: 'annex' },
    ])
  })

  it('keeps the Annex shut until the code has been read, wherever it is written', () => {
    const session = start()
    session.begin()
    session.continue()

    session.move({ do: 'go', room: 'annex' })
    expect(boardLog(session).at(-1)).toBe('You try the Annex door with your STAFF badge. It does not open.')

    // A note that talks about codes gives nothing away.
    session.move({ do: 'go', room: 'office' })
    expect(session.getState().puzzle!.moves.filter((m) => m.do === 'read')).toEqual([
      { do: 'read', spot: 'drawer' },
      { do: 'read', spot: 'intray' },
    ])
    session.move({ do: 'read', spot: 'drawer' })
    session.move({ do: 'read', spot: 'intray' })
    expect(boardLog(session).slice(-2)).toEqual([
      'You look in the desk drawer in the Office. There is a note: “MEMO. A door code is yours alone. Never write one down. Front Office.”',
      'You look in the in-tray in the Office. There is a note: “Staff picnic on Saturday the 13th. Bring a dish.”',
    ])
    expect(session.getState().puzzle!.play.state.badges).toEqual(['staff'])
    session.move({ do: 'go', room: 'annex' })
    expect(showing(session)).toBe('hoop:letter')

    // The letter does.
    session.move({ do: 'go', room: 'mail' })
    session.move({ do: 'read', spot: 'pigeon' })
    expect(boardLog(session).slice(-2)).toEqual([
      'You look in the pigeonhole in the Mail Room. There is a note: “To all Annex staff: the new keypad code is 4179.”',
      'Now you know the Annex code.',
    ])
    session.move({ do: 'go', room: 'annex' })
    expect(boardLog(session).at(-1)).toBe('You try the Annex door with your Annex code. It opens, and you walk in.')
    expect(showing(session)).toBe('say')
  })

  it('lets one door give up the code to the next', () => {
    const session = start()
    play(session, [], { letter: HOOPS['letter']! })
    expect(showing(session)).toBe('hoop:chain')
    expect(met(session, 'notes')).toBe(false)

    session.move({ do: 'go', room: 'vault' })
    expect(boardLog(session).at(-1)).toBe('You try the Vault door with your Annex code. It does not open.')
    for (const move of HOOPS['chain']!) session.move(move)
    expect(boardLog(session).slice(-2)).toEqual([
      'Now you know the Vault code.',
      'You try the Vault door with your Vault code. It opens, and you walk in.',
    ])
    expect(showing(session)).toBe('say')
    expect(met(session, 'notes')).toBe(true)
  })

  it('closes the hole only with a change that stops the trick, because of the rules', () => {
    const puzzle = game.levels[3]!.level.puzzle!
    const close = puzzle.stages.find((s) => s.id === 'close')!

    // The trick that is tried clears the hoop it comes from.
    let letter = startStage(puzzle, 'letter')
    for (const move of close.fix!.trick) letter = playMove(puzzle, letter, move)
    expect(letter.solved).toBe(true)

    // No change is marked right or wrong in the level file. Each is tried.
    const held = Object.keys(close.fix!.changes).map((change) => {
      const result = playMove(puzzle, startStage(puzzle, 'close'), { do: 'fix', change })
      return [change, result.solved] as const
    })
    expect(held).toEqual([
      ['longer', false],
      ['hide', false],
      ['shred', true],
      ['rotate', true],
    ])
  })

  it('shows the same search finding a hidden letter, and bouncing off a changed code', () => {
    const session = start()
    play(session, [], { ...HOOPS, close: [] })
    expect(showing(session)).toBe('hoop:close')

    session.move({ do: 'fix', change: 'hide' })
    expect(boardLog(session)).toEqual([
      'CHANGE: Hide the letter better. Move it from the pigeonhole to the bottom of the in-tray.',
      'The same trick is tried again, move for move.',
      'You try the Office door with your STAFF badge. It opens, and you walk in.',
      'You look in the desk drawer in the Office. There is a note: “MEMO. A door code is yours alone. Never write one down. Front Office.”',
      'You look in the in-tray in the Office. There is a note: “To all Annex staff: the new keypad code is 4179.”',
      'Now you know the Annex code.',
      'You try the Mail Room door with your STAFF badge. It opens, and you walk in.',
      'You try the Annex door with your Annex code. It opens, and you walk in.',
      'RESULT: the trick still works. That change did not close the hole.',
    ])
    expect(met(session, 'closed')).toBe(false)

    session.move({ do: 'fix', change: 'rotate' })
    expect(boardLog(session).slice(-3)).toEqual([
      'Now you know the Annex code.',
      'You try the Annex door with your Annex code. It does not open.',
      'RESULT: the trick fails. The hole is closed.',
    ])
    expect(session.getState().puzzle!.play.board.rooms['annex']!.opens_for).toEqual(['fresh'])
    expect(showing(session)).toBe('say')
    expect(met(session, 'closed')).toBe(true)
  })

  it('leaves nothing to read once the letter is shredded', () => {
    const session = start()
    play(session, [], { ...HOOPS, close: [] })
    session.move({ do: 'fix', change: 'shred' })
    expect(boardLog(session).join('\n')).not.toContain('4179')
    expect(boardLog(session).slice(-2)).toEqual([
      'You try the Annex door with your STAFF badge. It does not open.',
      'RESULT: the trick fails. The hole is closed.',
    ])
  })
})

describe('Level 4: the search', () => {
  it('is scaffolded: every step has a goal, a nudge, how to do it, and the command', () => {
    const { level } = game.levels[3]!
    expect(level.mode).toBe('scaffolded')
    const prompts = level.beats.flatMap((beat) => ('prompt' in beat ? [beat.prompt] : []))
    expect(prompts.map((p) => p.run)).toEqual(SUGGESTED)
    for (const prompt of prompts) {
      expect(prompt.goal.trim(), prompt.run).not.toBe('')
      expect(prompt.nudge?.trim() ?? '', `${prompt.run} nudge`).not.toBe('')
      expect(prompt.explain.trim(), `${prompt.run} how`).not.toBe('')
      expect(prompt.result?.trim() ?? '', `${prompt.run} result`).not.toBe('')
      // The goal and the nudge leave the command for the player to work out.
      expect(prompt.goal, prompt.run).not.toContain(prompt.run)
      expect(prompt.nudge, prompt.run).not.toContain(prompt.run)
    }
    for (const stage of level.puzzle!.stages) expect(stage.hints.length, stage.id).toBeGreaterThan(0)
  })

  it('moves on when the command behind the last hint is typed, and brings the printout afterwards', () => {
    const session = start()
    play(session, [])
    expect(showing(session)).toBe(SUGGESTED[0])
    expect(session.getState().tray).toEqual([])
    for (const line of SUGGESTED) {
      expect(showing(session)).toBe(line)
      session.run(line)
    }
    expect(session.getState().tray.map((t) => t.id)).toEqual(['sweep'])
    expect(showing(session)).toBe('say')
    session.continue()
    expect(showing(session)).toBe('log:count')
    expect(session.getState().objectives.filter((o) => !o.met).map((o) => o.id)).toEqual(['counted'])
  })

  it('accepts other ways of doing each step', () => {
    const session = start()
    play(session, [
      'cd /home; grep -il password */*',
      'ls -l /home/*/mbox',
      'grep -i password /home/jquill/mbox',
      'more /home/rvoss/getlog',
      'cat /home/osato/notes /home/dmbeki/todo /home/lfaber/memo',
    ])
    expect(`${showing(session)} (last line: ${session.commandRecords.at(-1)?.line})`).toBe(
      'log:count (last line: cat /home/osato/notes /home/dmbeki/todo /home/lfaber/memo)',
    )
  })

  it('counts the command file as read only once its secret has been on the screen', () => {
    const session = start()
    play(session, [])
    session.run('grep -i password /home/*/*')
    expect(met(session, 'found-mail')).toBe(true)
    expect(met(session, 'found-command-file')).toBe(false)
    session.run('tail -n 5 /home/rvoss/getlog')
    expect(met(session, 'found-command-file')).toBe(true)
  })

  it('takes the search a file at a time, or with the lines printed', () => {
    const piecemeal = start()
    play(piecemeal, [])
    piecemeal.run('grep -i -l password /home/jquill/* /home/dmbeki/*')
    piecemeal.run('grep -l password /home/rvoss/* /home/lfaber/*')
    expect(showing(piecemeal)).toBe(SUGGESTED[0])
    piecemeal.run('grep -c password /home/osato/* /home/ops/*')
    expect(showing(piecemeal)).toBe(SUGGESTED[1])

    const lines = start()
    play(lines, ['grep -i password /home/*/*'])
    expect(showing(lines)).toBe(SUGGESTED[1])
  })

  it('does not move on when a step misses the point', () => {
    const session = start()
    play(session, [])

    // Minding capitals misses the letter; a listing opens nothing; cat names nothing.
    for (const line of ['grep -l password /home/*/*', 'ls -l /home/*/*', 'cat /home/*/*', 'grep -i -l password /home/*']) {
      session.run(line)
      expect(showing(session), line).toBe(SUGGESTED[0])
    }
    expect(met(session, 'swept')).toBe(false)
    session.run(SUGGESTED[0]!)
    expect(met(session, 'swept')).toBe(true)

    // One of the two files is not a comparison.
    session.run('ls -l /home/jquill/mbox')
    expect(showing(session)).toBe(SUGGESTED[1])
    session.run(SUGGESTED[1]!)

    // The file that cannot be opened is not the one asked about.
    session.run('cat /home/tnakata/mbox')
    expect(showing(session)).toBe(SUGGESTED[2])
    session.run(SUGGESTED[2]!)

    // The matching line of the command file does not show the secret.
    session.run('grep -i password /home/rvoss/getlog')
    expect(showing(session)).toBe(SUGGESTED[3])
    session.run(SUGGESTED[3]!)

    // Names alone do not say which files are false alarms.
    session.run('grep -i -l password /home/*/*')
    expect(showing(session)).toBe(SUGGESTED[4])
  })
})

describe('Level 4: the logbook', () => {
  it('can be played from briefing to debrief', () => {
    const session = start()
    expect(session.getState().phase).toBe('brief')
    play(session)
    expect(showing(session)).toBe('log:count')
    for (const [entry, answer] of Object.entries(ANSWERS)) session.answer(entry, answer)
    expect(showing(session)).toBe('say')
    expect(session.getState().complete).toBe(false)
    session.continue()

    const state = session.getState()
    expect(state.objectives.filter((o) => !o.met)).toEqual([])
    expect(state.logbook.every((e) => e.complete)).toBe(true)
    expect(state.phase).toBe('debrief')
    expect(session.loaded.card.title).toBe('Passwords in the clear')
  })

  it('says under every blank what goes in it, and where to look for it', () => {
    for (const entry of game.levels[3]!.level.logbook) {
      if (!('fill' in entry)) continue
      for (const [name, blank] of Object.entries(entry.blanks)) {
        expect(blank.label, `${entry.id}.${name} label`).toBeTruthy()
        expect(blank.hint, `${entry.id}.${name} hint`).toBeTruthy()
      }
    }
  })

  it('counts files that give a password away, not files that use the word', () => {
    const session = start()
    play(session)

    // Six with the file that could not be opened; five that mention it; three that matter.
    const all = session.answer('count', { kind: 'fill', values: { hits: '6', real: '5' } })
    expect(all.blanks).toEqual({ hits: false, real: false })
    expect(all.hint).toContain('Permission denied is not one of them')
    const alarms = session.answer('count', { kind: 'fill', values: { hits: '5', real: '5' } })
    expect(alarms.blanks).toEqual({ hits: true, real: false })
    expect(alarms.hint).toContain('false alarms')
    expect(met(session, 'counted')).toBe(false)
    expect(session.answer('count', { kind: 'fill', values: { hits: 'five: 5', real: '3 files' } }).correct).toBe(true)
    expect(met(session, 'counted')).toBe(true)

    const wrong = session.answer('exposed', { kind: 'choose', chosen: ['mbox', 'getlog', 'memo'] })
    expect(wrong).toMatchObject({ correct: false, hint: expect.stringContaining('lets nobody in') })
    expect(session.answer('exposed', { kind: 'choose', chosen: ['notes', 'mbox', 'getlog'] }).correct).toBe(true)

    expect(session.answer('shut', { kind: 'fill', values: { account: 'jquill', root: 'root' } }).blanks).toEqual({
      account: false,
      root: true,
    })
    expect(session.answer('shut', { kind: 'fill', values: { account: 'Tnakata', root: 'ROOT' } }).correct).toBe(true)

    // The proof is his search on paper: not the player's own, and not what he read afterwards.
    const pin = (text: string, source = 'printout:sweep'): boolean =>
      session.answer('proof', { kind: 'pin', text, source }).correct
    expect(pin('grep -i -l password /home/*/*', 'terminal')).toBe(false)
    expect(pin('01:41  /home/jquill/mbox')).toBe(false)
    expect(pin('01:43  granite$ grep -i password /home/jquill/mbox')).toBe(false)
    expect(pin('01:52  granite$ cat /etc/passwd')).toBe(false)
    expect(pin(SEARCH)).toBe(true)
  })

  it('wants both halves of the fix, in the words of the computer or of the building', () => {
    const fix = (text: string): boolean => {
      const session = start()
      play(session)
      for (const entry of ['count', 'exposed', 'shut', 'proof']) session.answer(entry, ANSWERS[entry]!)
      expect(showing(session)).toBe('log:fix')
      return session.answer('fix', { kind: 'write', text }).correct
    }
    expect(fix('Change the passwords and delete them from those files.')).toBe(true)
    expect(fix('Pick a new password on basalt and flint, and never keep it in a file again')).toBe(true)
    expect(fix('Change the code and shred the letter.')).toBe(true)
    expect(fix('Reset all three and memorize them instead.')).toBe(true)
    // One half is not enough, and neither wrong change from the whiteboard is a fix.
    expect(fix('Delete the passwords from the files.')).toBe(false)
    expect(fix('Change the three passwords.')).toBe(false)
    expect(fix('Make the passwords much longer.')).toBe(false)
    expect(fix('Hide the files somewhere better.')).toBe(false)
  })

  it('rebuilds the same level from its recorded events', () => {
    const session = start()
    play(session, SUGGESTED.slice(0, 2), { ...HOOPS, close: [{ do: 'fix', change: 'longer' }, { do: 'fix', change: 'shred' }] })
    expect(showing(session)).toBe(SUGGESTED[2])

    const replay = start()
    for (const event of session.events) replay.apply(event)
    expect(replay.getState()).toEqual(session.getState())
    expect(replay.getState().puzzle!.play.tried).toEqual([
      { change: 'longer', held: false },
      { change: 'shred', held: true },
    ])
  })
})

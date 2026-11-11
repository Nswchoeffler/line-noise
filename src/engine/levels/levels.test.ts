import { beforeEach, describe, expect, it } from 'vitest'
import { programs } from '../shell/commands/index.ts'
import { ROOT } from '../vfs/index.ts'
import { parseTime } from '../world/time.ts'
import { buildWorld, loadGame, type LoadedGame } from './loader.ts'
import { grade } from './logbook.ts'
import { LevelSession, type LevelEvent } from './runner.ts'
import type { LogbookEntry } from './schema.ts'
import { TEST_FILES, testSource } from './testing.ts'

let game: LoadedGame

function start(levelIndex: number): LevelSession {
  return new LevelSession({
    loaded: game.levels[levelIndex]!,
    world: buildWorld(game, levelIndex, programs),
    programs,
    tty: game.game.tty,
  })
}

const out = (session: LevelSession, line: string): string =>
  session
    .run(line)
    .output.map((c) => c.text)
    .join('')

beforeEach(() => {
  game = loadGame(testSource())
})

describe('loading a game', () => {
  it('reads the game, its hosts, levels and cards', () => {
    expect(game.game.title).toBe('Test Game')
    expect(game.game.start).toBe(parseTime('1986-09-09 08:15'))
    expect(game.hosts.map((h) => h.name)).toEqual(['box'])
    expect(game.levels.map((l) => l.level.id)).toEqual(['L01-first', 'L02-second'])
    expect(game.levels[0]!.card.title).toBe('Logs are evidence')
    expect(game.levels[0]!.tray.map((t) => t.id)).toEqual(['memo'])
  })

  it('names the file when something is missing or malformed', () => {
    expect(() => loadGame(testSource(), 'nope.yaml')).toThrow('content file not found: nope.yaml')
    expect(() => loadGame(testSource({ 'cards/first.yaml': 'title: [unclosed' }))).toThrow(
      'cards/first.yaml is not valid YAML',
    )
    expect(() =>
      loadGame(testSource({ 'cards/first.yaml': 'id: first\ntitle: No source\n' })),
    ).toThrow('cards/first.yaml is not valid')
  })

  it('requires level numbers to match play order', () => {
    const swapped = TEST_FILES['game.yaml']!.replace(
      '[levels/L01-first.yaml, levels/L02-second.yaml]',
      '[levels/L02-second.yaml, levels/L01-first.yaml]',
    )
    expect(() => loadGame(testSource({ 'game.yaml': swapped }))).toThrow('says number 2')
  })

  const broken = (find: string, replace: string): (() => unknown) => {
    const text = TEST_FILES['levels/L01-first.yaml']!
    expect(text).toContain(find)
    return () => loadGame(testSource({ 'levels/L01-first.yaml': text.replace(find, replace) }))
  }

  it('rejects a level that refers to things that do not exist', () => {
    expect(broken('log: { entry: finding }', 'log: { entry: missing }')).toThrow(
      'refers to logbook entry "missing"',
    )
    expect(broken('deliver: { item: memo }', 'deliver: { item: ghost }')).toThrow('delivers "ghost"')
    expect(broken('correct: [a, c]', 'correct: [a, z]')).toThrow('"z" is not an option')
    expect(broken('correct: [a, c]', 'correct: [a]')).toThrow('asks for 2 but 1 are correct')
  })

  it('rejects blanks that do not match the sentence', () => {
    expect(broken('{name} appears', '{who} appears')).toThrow('no blank defined for {who}')
    expect(broken('name: { accept: [alpha] }', 'name: { accept: [alpha], number: { value: 1 } }')).toThrow(
      'exactly one of',
    )
  })

  it('rejects unknown keys and empty predicates', () => {
    expect(broken('mode: guided', 'mode: guided\ncolour: red')).toThrow('colour')
    expect(broken('when: { read: /data/list }', 'when: { host: box }')).toThrow('must check something')
    expect(broken('when: { read: /data/list }', 'when: { typed: "cat list" }')).toThrow('typed')
  })
})

describe('building the world for a level', () => {
  it('starts level 1 from the base hosts at the game start time', () => {
    const world = buildWorld(game, 0, programs)
    expect(world.hosts.map((h) => h.name)).toEqual(['box'])
    expect(world.clock.now).toBe(parseTime('1986-09-09 08:15'))
    expect(world.host('box').fs.peek('/data/new')).toBeUndefined()
  })

  it('applies every setup up to the level: overlays, clones, then the clock', () => {
    const world = buildWorld(game, 1, programs)
    expect(world.clock.now).toBe(parseTime('1986-09-10 09:00'))
    expect(world.host('box').fs.peek('/data/new')).toBe('added in level two\n')
    // The clone copies the host after its own overlay, then gets its own changes.
    expect(world.host('sandbox').fs.peek('/data/new')).toBe('added in level two\n')
    expect(world.host('sandbox').fs.peek('/etc/motd')).toBe('This is the sandbox.\n')
    expect(world.host('box').fs.peek('/etc/motd')).toBeUndefined()
  })

  it('does not depend on how earlier levels were played', () => {
    const played = start(0)
    played.begin()
    played.run('echo scratch > /tmp/mine')
    const fresh = buildWorld(game, 1, programs)
    expect(fresh.host('box').fs.peek('/tmp/mine')).toBeUndefined()
    expect(fresh.serialize()).toEqual(buildWorld(game, 1, programs).serialize())
  })

  it('refuses a setup that would turn the clock back', () => {
    const early = TEST_FILES['levels/L02-second.yaml']!.replace('1986-09-10 09:00', '1986-09-01 09:00')
    const g = loadGame(testSource({ 'levels/L02-second.yaml': early }))
    expect(() => buildWorld(g, 1, programs)).toThrow('earlier than the clock')
  })
})

describe('marking logbook answers', () => {
  const entries = (): LogbookEntry[] => [...game.levels[0]!.level.logbook, ...game.levels[1]!.level.logbook]
  const entry = (id: string): LogbookEntry => entries().find((e) => e.id === id)!

  it('marks each blank, ignoring case and spacing', () => {
    expect(grade(entry('finding'), { kind: 'fill', values: { name: '  ALPHA ', count: '2' } })).toEqual({
      correct: true,
      blanks: { name: true, count: true },
    })
  })

  it('accepts a number written with words around it, within tolerance', () => {
    const fill = (count: string) => grade(entry('finding'), { kind: 'fill', values: { name: 'alpha', count } })
    expect(fill('2 times').correct).toBe(true)
    expect(fill('about 2').correct).toBe(true)
    expect(fill('3').correct).toBe(false)
    expect(fill('two').correct).toBe(false)
  })

  it('gives the hint for a blank that was tried and is wrong, not for one left empty', () => {
    expect(grade(entry('finding'), { kind: 'fill', values: { name: 'alpha', count: '9' } })).toEqual({
      correct: false,
      blanks: { name: true, count: false },
      hint: 'Look at the number uniq -c printed.',
    })
    expect(grade(entry('finding'), { kind: 'fill', values: { name: 'alpha', count: '' } }).hint).toBeUndefined()
  })

  it('marks a choice right only when exactly the correct options are picked', () => {
    const choose = (chosen: string[]) => grade(entry('which'), { kind: 'choose', chosen })
    expect(choose(['c', 'a'])).toEqual({ correct: true })
    expect(choose(['a', 'b'])).toEqual({ correct: false, hint: 'One of these is too strong.' })
    expect(choose(['a']).correct).toBe(false)
    expect(choose(['a', 'b', 'c']).correct).toBe(false)
  })

  it('marks a pinned line by what it shows', () => {
    const pin = (text: string) => grade(entry('proof'), { kind: 'pin', text, source: 'terminal' })
    expect(pin('-rwsr-xr-x  1 root     wheel         43 Mar  1  1985 helper').correct).toBe(true)
    expect(pin('-rwxr-xr-x  1 root     wheel      14336 Mar  1  1985 ls')).toEqual({
      correct: false,
      hint: 'Use ls -l.',
    })
  })

  it('accepts a written sentence that mentions each idea', () => {
    const write = (text: string) => grade(entry('fix'), { kind: 'write', text }).correct
    expect(write('Remove the setuid bit from the helper.')).toBe(true)
    expect(write('I ran chmod u-s on helper')).toBe(true)
    expect(write('Remove the setuid bit.')).toBe(false)
    expect(write('helper setuid')).toBe(false) // too short to be a sentence
  })

  it('never accepts an answer of the wrong kind', () => {
    expect(grade(entry('finding'), { kind: 'write', text: 'alpha 2' }).correct).toBe(false)
    expect(grade(entry('which'), { kind: 'fill', values: {} }).correct).toBe(false)
  })
})

describe('a guided level, start to finish', () => {
  let s: LevelSession

  beforeEach(() => {
    s = start(0)
  })

  it('starts with the briefing and nothing in play', () => {
    expect(s.getState()).toMatchObject({ phase: 'brief', host: 'box', beat: null, complete: false })
    expect(s.getState().objectives.every((o) => !o.met)).toBe(true)
  })

  it('logs the player in on the starting host', () => {
    expect(out(s, 'who')).toBe('ops      ttyp2    Sep  9 08:15\n')
    expect(s.prompt).toBe('box$ ')
  })

  it('walks through the beats in order', () => {
    s.begin()
    expect(s.getState().beat).toEqual({ say: { who: 'guide', text: 'Welcome.' } })

    s.continue()
    expect(s.getState().beat).toMatchObject({ prompt: { run: 'cd /data' } })

    s.run('cd /data')
    expect(s.getState().beat).toMatchObject({ prompt: { run: 'cat list' } })

    s.run('cat list')
    // The memo is delivered on the way to the next prompt.
    expect(s.getState().tray.map((t) => t.id)).toEqual(['memo'])
    expect(s.getState().beat).toMatchObject({ prompt: { run: 'sort list | uniq -c' } })

    s.run('sort list | uniq -c')
    expect(s.getState().beat).toEqual({ log: { entry: 'finding' } })
  })

  it('does not advance on a command that fails or misses the point', () => {
    s.begin()
    s.continue()
    s.run('cd /nowhere')
    s.run('pwd')
    expect(s.getState()).toMatchObject({ beatIndex: 1, attempts: 2 })
    s.run('cd /data')
    s.run('cat lst') // a typo: cat ran, but failed
    expect(s.getState().beat).toMatchObject({ prompt: { run: 'cat list' } })
    s.run('sort list') // half of a later pipeline is not this beat
    expect(s.getState().beat).toMatchObject({ prompt: { run: 'cat list' } })
  })

  it('accepts any route that gets the job done, not one exact command', () => {
    s.begin()
    s.continue()
    s.run('cd /tmp')
    s.run('cd ../data') // a different path to the same place
    expect(s.getState().beatIndex).toBe(2)
    s.run('cat /data/list /data/list') // different arguments
    expect(s.getState().beatIndex).toBe(4)
    s.run('cat list | sort | uniq -c | sort -rn') // a longer pipeline
    expect(s.getState().beat).toEqual({ log: { entry: 'finding' } })
  })

  it('does not let an earlier command satisfy a later prompt', () => {
    s.begin()
    s.run('cat /data/list') // before being asked: the "say" beat is still current
    s.continue()
    s.run('cd /data')
    expect(s.getState().beat).toMatchObject({ prompt: { run: 'cat list' } })
  })

  it('skips a prompt whose goal is already true', () => {
    s.begin()
    s.run('cd /data')
    s.continue()
    expect(s.getState().beat).toMatchObject({ prompt: { run: 'cat list' } })
  })

  it('latches objectives the moment they are met, whatever the current beat', () => {
    s.begin()
    s.run('cat /data/list')
    expect(s.getState().objectives).toEqual([
      { id: 'read-list', text: 'Read the list', met: true },
      { id: 'counted', text: 'Count the names', met: false },
    ])
    s.run('sort /data/list | uniq -c')
    expect(s.getState().objectives.every((o) => o.met)).toBe(true)
  })

  it('opens a logbook entry when its beat is reached; others are open from the start', () => {
    s.begin()
    const open = () => Object.fromEntries(s.getState().logbook.map((e) => [e.entry.id, e.open]))
    expect(open()).toEqual({ finding: false, which: true })
    s.continue()
    s.run('cd /data')
    s.run('cat list')
    s.run('sort list | uniq -c')
    expect(open()).toEqual({ finding: true, which: true })
  })

  it('ignores answers to an entry that is not open yet', () => {
    s.begin()
    const result = s.answer('finding', { kind: 'fill', values: { name: 'alpha', count: '2' } })
    expect(result.correct).toBe(false)
    expect(s.getState().logbook[0]).toMatchObject({ complete: false, answer: null })
    expect(s.events).toEqual([{ type: 'begin' }])
  })

  function playThrough(session: LevelSession): void {
    session.begin()
    session.continue()
    session.run('cd /data')
    session.run('cat list')
    session.run('sort list | uniq -c')
    session.answer('finding', { kind: 'fill', values: { name: 'beta', count: '2' } }) // wrong first
    session.answer('finding', { kind: 'fill', values: { name: 'alpha', count: '2' } })
    session.continue() // five minutes pass
    session.answer('which', { kind: 'choose', chosen: ['a', 'c'] })
    session.continue() // the last line
  }

  it('lets the player try a logbook answer again, and keeps a right answer', () => {
    s.begin()
    s.continue()
    s.run('cd /data')
    s.run('cat list')
    s.run('sort list | uniq -c')
    expect(s.answer('finding', { kind: 'fill', values: { name: 'beta', count: '2' } })).toMatchObject({
      correct: false,
      blanks: { name: false, count: true },
    })
    expect(s.getState().beat).toEqual({ log: { entry: 'finding' } })
    expect(s.answer('finding', { kind: 'fill', values: { name: 'alpha', count: '2' } }).correct).toBe(true)
    expect(s.getState().beat).toMatchObject({ advance: { seconds: 300 } })
    // A completed entry cannot be un-completed.
    expect(s.answer('finding', { kind: 'fill', values: { name: 'wrong', count: '0' } }).correct).toBe(true)
    expect(s.getState().logbook[0]!.complete).toBe(true)
  })

  it('moves the clock when the player continues past an advance beat', () => {
    s.begin()
    s.continue()
    s.run('cd /data')
    s.run('cat list')
    s.run('sort list | uniq -c')
    s.answer('finding', { kind: 'fill', values: { name: 'alpha', count: '2' } })
    const before = s.world.clock.now
    s.continue()
    expect(s.world.clock.now).toBe(before + 300)
    expect(out(s, 'date')).toBe('Tue Sep  9 08:20:00 PDT 1986\n')
  })

  it('completes only when beats, objectives and the logbook are all done', () => {
    s.begin()
    s.continue()
    s.run('cd /data')
    s.run('cat list')
    s.run('sort list | uniq -c')
    s.answer('finding', { kind: 'fill', values: { name: 'alpha', count: '2' } })
    s.continue()
    s.continue()
    // Every beat is done, but one logbook entry is still open.
    expect(s.getState()).toMatchObject({ phase: 'play', beat: null, complete: false })
    s.answer('which', { kind: 'choose', chosen: ['a', 'c'] })
    expect(s.getState()).toMatchObject({ phase: 'debrief', complete: true })
  })

  it('tells subscribers about every change', () => {
    let calls = 0
    const stop = s.subscribe(() => calls++)
    s.begin()
    s.continue()
    s.run('pwd')
    expect(calls).toBe(3)
    stop()
    s.run('pwd')
    expect(calls).toBe(3)
  })

  it('records every input as an event', () => {
    playThrough(s)
    expect(s.getState().complete).toBe(true)
    expect(s.events.map((e) => e.type)).toEqual([
      'begin',
      'continue',
      'command',
      'command',
      'command',
      'answer',
      'answer',
      'continue',
      'answer',
      'continue',
    ])
  })

  it('rebuilds exactly the same level when its events are played back', () => {
    playThrough(s)
    const saved: LevelEvent[] = JSON.parse(JSON.stringify(s.events))

    const replayed = start(0)
    for (const event of saved) replayed.apply(event)

    expect(replayed.getState()).toEqual(s.getState())
    expect(replayed.world.serialize()).toEqual(s.world.serialize())
    expect(replayed.shell.serialize()).toEqual(s.shell.serialize())
    expect(replayed.commandRecords).toEqual(s.commandRecords)
  })

  it('ignores Continue when there is nothing to continue past', () => {
    s.begin()
    s.continue()
    s.continue() // a prompt is current: Continue does nothing
    expect(s.getState().beatIndex).toBe(1)
    expect(s.events).toHaveLength(2)
  })

  it('stops recording once the level is complete', () => {
    playThrough(s)
    const count = s.events.length
    s.run('ls')
    s.continue()
    expect(s.events).toHaveLength(count)
  })
})

describe('an open level on a second host', () => {
  let s: LevelSession

  beforeEach(() => {
    s = start(1)
    s.begin()
  })

  it('moves the terminal to the other host and logs in there', () => {
    expect(s.getState()).toMatchObject({ host: 'sandbox', beat: null })
    expect(s.prompt).toBe('sandbox$ ')
    expect(out(s, 'cat /etc/motd')).toBe('This is the sandbox.\n')
    expect(out(s, 'who')).toContain('ops      ttyp2    Sep 10 09:00')
  })

  it('leaves the original host untouched by what happens on the copy', () => {
    s.run('helper')
    expect(s.world.host('sandbox').fs.inspect('/tmp/rootsh')).toBeDefined()
    expect(s.world.host('box').fs.inspect('/tmp/rootsh')).toBeUndefined()
  })

  it('meets objectives in any order the player manages, from the state of the world', () => {
    const met = () => s.getState().objectives.filter((o) => o.met).map((o) => o.id)
    s.run('ls -l /usr/local/bin/helper')
    expect(met()).toEqual(['saw-bit'])

    s.run('helper') // the setuid script leaves a root shell in /tmp
    s.run('/tmp/rootsh')
    expect(met()).toEqual(['saw-bit', 'became-root'])
    expect(s.prompt).toBe('sandbox# ')

    s.run('chmod u-s /usr/local/bin/helper')
    expect(met()).toEqual(['saw-bit', 'became-root', 'fixed'])

    // Objectives stay met even when the state that met them is gone.
    s.run('exit')
    expect(out(s, 'whoami')).toBe('ops\n')
    expect(met()).toEqual(['saw-bit', 'became-root', 'fixed'])
  })

  it('counts a failure only after the fix, because of the permission model', () => {
    const confirmed = () => s.getState().objectives.find((o) => o.id === 'confirmed')!.met

    expect(s.run('helper').status).toBe(0)
    expect(s.world.host('sandbox').fs.inspect('/tmp/rootsh')).toMatchObject({ uid: 0, mode: 0o4755 })
    expect(confirmed()).toBe(false)

    s.run('/tmp/rootsh')
    s.run('chmod u-s /usr/local/bin/helper')
    s.run('exit')

    // Without the bit the script runs as ops, who may not overwrite root's file.
    const after = s.run('helper')
    expect(after.status).not.toBe(0)
    expect(after.output.map((c) => c.text).join('')).toContain('Permission denied')
    expect(confirmed()).toBe(true)
  })

  it('after the fix, the helper can only make a shell owned by whoever ran it', () => {
    s.run('helper')
    s.run('/tmp/rootsh')
    s.run('chmod u-s /usr/local/bin/helper; rm /tmp/rootsh')
    s.run('exit')

    s.run('helper')
    expect(s.world.host('sandbox').fs.stat('/tmp/rootsh', ROOT).uid).toBe(100)
    s.run('/tmp/rootsh')
    expect(out(s, 'whoami')).toBe('ops\n')
  })

  it('completes with pinned evidence and a written answer', () => {
    const listing = out(s, 'ls -l /usr/local/bin/helper')
    s.run('helper')
    s.run('/tmp/rootsh')
    s.run('chmod u-s /usr/local/bin/helper')
    s.run('exit')
    s.run('helper')
    expect(s.getState().objectives.every((o) => o.met)).toBe(true)
    expect(s.getState().complete).toBe(false)

    expect(s.answer('proof', { kind: 'pin', text: 'total 4', source: 'terminal' }).correct).toBe(false)
    expect(s.answer('proof', { kind: 'pin', text: listing.trimEnd(), source: 'terminal' }).correct).toBe(true)
    expect(s.answer('fix', { kind: 'write', text: 'Take the setuid bit off the helper.' }).correct).toBe(true)
    expect(s.getState()).toMatchObject({ phase: 'debrief', complete: true })
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { buildWorld, loadGame, type LoadedGame } from '../engine/levels/loader.ts'
import { LevelSession } from '../engine/levels/runner.ts'
import { programs } from '../engine/shell/commands/index.ts'
import { ROOT } from '../engine/vfs/index.ts'
import { contentSource } from './index.ts'

// The real game's content: it loads, the world holds together, and each level
// can be played from briefing to debrief.

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

/** What the guidance panel is showing: the command to type, or the kind of beat. */
function showing(session: LevelSession): string {
  const beat = session.getState().beat
  if (!beat) return 'nothing'
  if ('prompt' in beat) return beat.prompt.run
  if ('log' in beat) return `log:${beat.log.entry}`
  return Object.keys(beat)[0]!
}

beforeEach(() => {
  game = loadGame(contentSource)
})

describe('the world', () => {
  it('loads, with granite as the only host so far', () => {
    expect(game.game.title).toBe('Line Noise')
    expect(game.hosts.map((h) => h.name)).toEqual(['granite'])
    expect(game.levels.map((l) => l.level.id)).toEqual(['L01-the-discrepancy'])
  })

  it('has the accounts the brief lists', () => {
    const users = game.hosts[0]!.users.map((u) => u.name)
    expect(users).toEqual(expect.arrayContaining(['root', 'marge', 'ops', 'hollis', 'pike']))
    expect(users).toHaveLength(11) // those five and six ordinary staff
  })

  it('has a manual page for every command installed', () => {
    const fs = buildWorld(game, 0, programs).host('granite').fs
    for (const name of [...programs.keys(), 'cd']) {
      expect(fs.peek(`/usr/man/man1/${name}.1`), `man page for ${name}`).toContain(`${name} - `)
    }
  })

  it('keeps two sets of books that differ by exactly the unbilled account', () => {
    const fs = buildWorld(game, 0, programs).host('granite').fs
    const usage = fs.peek('/usr/adm/usage.log')!.trim().split('\n').map((line) => line.split('\t'))
    const ledger = fs.peek('/usr/local/billing/ledger')!.trim().split('\n').map((line) => line.split('\t'))

    const minutes = (rows: string[][]): number => rows.reduce((sum, row) => sum + Number(row[4]) / 60, 0)
    const billed = ledger.reduce((sum, row) => sum + Number(row[1]), 0)
    const unbilled = usage.filter((row) => row[0] === 'pike')

    expect(minutes(usage) - billed).toBe(23)
    expect(minutes(unbilled)).toBe(23)
    expect((23 * 5) / 100).toBe(1.15)
    expect(fs.peek('/usr/local/billing/reconcile.aug')).toContain('$1.15')

    // Every other account is billed for exactly what it used.
    for (const [account, billedMinutes, charge] of ledger) {
      expect(minutes(usage.filter((row) => row[0] === account)), account).toBe(Number(billedMinutes))
      expect(Number(charge), account).toBeCloseTo(Number(billedMinutes) * 0.05, 2)
    }
  })

  it('has paperwork for every account in the ledger, and none for the one that is not', () => {
    const fs = buildWorld(game, 0, programs).host('granite').fs
    const requests = fs.entries('/usr/local/billing/requests')
    const ledger = fs.peek('/usr/local/billing/ledger')!.trim().split('\n').map((line) => line.split('\t')[0]!)
    expect([...(requests ?? [])].sort()).toEqual([...ledger].sort())
    expect(requests).not.toContain('pike')
  })

  it('shows who is at work when the player logs in', () => {
    const session = start(0)
    const who = out(session, 'who')
    expect(who).toMatch(/^marge\s+ttyh0/m)
    expect(who).toMatch(/^ops\s+ttyh4\s+Sep  2 08:40/m)
    expect(out(session, 'date')).toBe('Tue Sep  2 08:40:00 PDT 1986\n')
  })

  it('lets the player read the books but not change them', () => {
    const session = start(0)
    expect(out(session, 'echo x >> /usr/local/billing/ledger')).toContain('Permission denied')
    expect(out(session, 'echo x >> /usr/adm/usage.log')).toContain('Permission denied')
    expect(session.world.host('granite').fs.stat('/usr/adm/usage.log', ROOT).mode & 0o777).toBe(0o644)
  })
})

describe('Level 1: The Discrepancy', () => {
  /** The route Marge suggests, one line per prompt. */
  const SUGGESTED = [
    'pwd',
    'cd /usr/local/billing',
    'ls -l',
    'cat reconcile.aug',
    'cat ledger',
    'head /usr/adm/usage.log',
    'wc -l /usr/adm/usage.log',
    'cut -f1 /usr/adm/usage.log | head',
    'cut -f1 /usr/adm/usage.log | sort | uniq -c',
    'cut -f1 /usr/adm/usage.log | sort | uniq > /tmp/used',
    'cut -f1 ledger | sort > /tmp/billed',
    'diff /tmp/billed /tmp/used',
    'grep pike /usr/adm/usage.log',
    'grep pike ledger',
  ]

  /**
   * Play the terminal part of the level, typing one of `lines` at each prompt
   * in place of the suggestion. Stops at the logbook, or at the first line
   * that does not satisfy its prompt.
   */
  function investigate(session: LevelSession, lines: readonly string[] = SUGGESTED): void {
    session.begin()
    let next = 0
    for (let guard = 0; guard < 100; guard++) {
      const beat = session.getState().beat
      if (!beat || 'log' in beat) return
      if ('say' in beat) {
        session.continue()
        continue
      }
      const line = lines[next++]
      if (line === undefined) return
      const prompt = showing(session)
      session.run(line)
      if (showing(session) === prompt) return
    }
    throw new Error('the level did not reach its logbook')
  }

  function fillLogbook(session: LevelSession): void {
    session.answer('account', { kind: 'fill', values: { account: 'pike' } })
    session.answer('time', { kind: 'fill', values: { sessions: '3', minutes: '23', amount: '1.15' } })
    session.answer('first', { kind: 'fill', values: { day: '24', time: '03:05' } })
    session.answer('evidence', { kind: 'pin', text: 'pike\tttyn1\tAug 24\t03:05\t420', source: 'terminal' })
  }

  it('suggests each command in turn, and each suggestion does its job', () => {
    const session = start(0)
    session.begin()
    const suggested: string[] = []
    for (let guard = 0; guard < 100; guard++) {
      const beat = session.getState().beat
      if (!beat || 'log' in beat) break
      if ('say' in beat) {
        session.continue()
        continue
      }
      const line = showing(session)
      suggested.push(line)
      const record = session.run(line)
      expect(record.output.filter((c) => c.stream === 'err'), line).toEqual([])
      // One line is enough to move on from every prompt.
      expect(showing(session), `after: ${line}`).not.toBe(line)
    }
    expect(suggested).toEqual(SUGGESTED)
    expect(showing(session)).toBe('log:account')
  })

  it('shows the player what the mentor says it shows', () => {
    const session = start(0)
    session.begin()
    session.continue()
    expect(out(session, 'pwd')).toBe('/home/ops\n')
    out(session, 'cd /usr/local/billing')
    expect(out(session, 'ls -l')).toMatch(/ledger\n[\s\S]*reconcile\.aug\n[\s\S]*requests\n/)
    expect(out(session, 'cat reconcile.aug')).toMatch(/Difference\s+23\s+\$1\.15/)
    session.continue()
    expect(out(session, 'cat ledger').trim().split('\n')).toHaveLength(9)
    expect(out(session, 'head /usr/adm/usage.log').trim().split('\n')).toHaveLength(10)
    expect(out(session, 'wc -l /usr/adm/usage.log')).toMatch(/^\s*181\b/)
    out(session, 'cut -f1 /usr/adm/usage.log | head')
    const counts = out(session, 'cut -f1 /usr/adm/usage.log | sort | uniq -c')
    expect(counts.trim().split('\n')).toHaveLength(9)
    expect(counts).toMatch(/^\s+3 pike$/m)
    session.continue()
    expect(out(session, 'cut -f1 /usr/adm/usage.log | sort | uniq > /tmp/used')).toBe('')
    expect(out(session, 'cut -f1 ledger | sort > /tmp/billed')).toBe('')
    // Exactly two differences: the dormant account and the unbilled one.
    const differences = out(session, 'diff /tmp/billed /tmp/used').split('\n').filter((l) => /^[<>]/.test(l))
    expect(differences).toEqual(['< hollis', '> pike'])
    session.continue()
    expect(out(session, 'grep pike /usr/adm/usage.log')).toBe(
      'pike\tttyn1\tAug 24\t03:05\t420\n' + 'pike\tttyn1\tAug 27\t02:40\t540\n' + 'pike\tttyn1\tAug 30\t01:15\t420\n',
    )
    expect(out(session, 'grep pike ledger')).toBe('')
    expect(showing(session)).toBe('log:account')
  })

  it('can be played from briefing to debrief', () => {
    const session = start(0)
    expect(session.getState().phase).toBe('brief')
    investigate(session)
    fillLogbook(session)
    expect(showing(session)).toBe('say')
    expect(session.getState().complete).toBe(false)
    session.continue()

    const state = session.getState()
    expect(state.objectives.filter((o) => !o.met)).toEqual([])
    expect(state.logbook.every((e) => e.complete)).toBe(true)
    expect(state.phase).toBe('debrief')
    expect(session.loaded.card.title).toBe('Logs are evidence')
  })

  it('accepts other ways of doing each step', () => {
    const session = start(0)
    const lastLine = (): string => session.commandRecords.at(-1)?.line ?? ''
    investigate(session, [
      'pwd',
      'cd /usr/local; cd billing',
      'ls',
      'more reconcile.aug',
      'more /usr/local/billing/ledger',
      'tail -n 5 /usr/adm/usage.log',
      'cat /usr/adm/usage.log | wc -l',
      'head /usr/adm/usage.log | cut -f1',
      'sort /usr/adm/usage.log | cut -f1 | uniq -c | sort -n',
      'cut -f1 /usr/adm/usage.log | sort -u > /tmp/used',
      'sort ledger | cut -f1 > /tmp/billed',
      'diff /tmp/used /tmp/billed; diff /tmp/billed /tmp/used',
      'grep -n pike /usr/adm/usage.log',
      'grep -c pike /usr/local/billing/ledger',
    ])
    expect(`${showing(session)} (last line: ${lastLine()})`).toBe(
      'log:account (last line: grep -c pike /usr/local/billing/ledger)',
    )
  })

  it('does not move on when a step misses the point', () => {
    const session = start(0)
    session.begin()
    session.continue()
    session.run('whoami')
    expect(showing(session)).toBe('pwd')
    session.run('pwd')
    session.run('cd /usr/adm')
    expect(showing(session)).toBe('cd /usr/local/billing')
    session.run('cd /usr/local/billing')
    session.run('ls -l /usr/adm')
    expect(showing(session)).toBe('ls -l')
    session.run('ls -l')
    session.run('cat reconcile.sep')
    expect(showing(session)).toBe('cat reconcile.aug')
  })

  it('does not count a mistyped file name as finding nothing in the ledger', () => {
    const session = start(0)
    investigate(session, [...SUGGESTED.slice(0, -1), 'grep pike leger'])
    expect(showing(session)).toBe('grep pike ledger')
  })

  it('marks the logbook by what was found, in whatever form it is written', () => {
    const session = start(0)
    investigate(session)

    expect(session.answer('account', { kind: 'fill', values: { account: 'hollis' } })).toMatchObject({
      correct: false,
      hint: expect.stringContaining('diff'),
    })
    expect(session.answer('account', { kind: 'fill', values: { account: ' Pike ' } }).correct).toBe(true)

    // 1380 seconds is not the answer in minutes.
    const seconds = session.answer('time', { kind: 'fill', values: { sessions: '3', minutes: '1380', amount: '1.15' } })
    expect(seconds.blanks).toEqual({ sessions: true, minutes: false, amount: true })
    expect(seconds.hint).toContain('divide by 60')
    expect(
      session.answer('time', { kind: 'fill', values: { sessions: 'three: 3', minutes: '23 minutes', amount: '$1.15' } })
        .correct,
    ).toBe(true)

    for (const time of ['3:05', '03:05', '0305', '3:05 am', '3.05 AM']) {
      const fresh = start(0)
      investigate(fresh)
      fresh.answer('account', { kind: 'fill', values: { account: 'pike' } })
      fresh.answer('time', { kind: 'fill', values: { sessions: '3', minutes: '23', amount: '1.15' } })
      expect(fresh.answer('first', { kind: 'fill', values: { day: '24', time } }).correct, time).toBe(true)
    }
    expect(session.answer('first', { kind: 'fill', values: { day: '30', time: '01:15' } }).correct).toBe(false)
    expect(session.answer('first', { kind: 'fill', values: { day: '24th', time: '15:05' } }).blanks).toEqual({
      day: true,
      time: false,
    })
    session.answer('first', { kind: 'fill', values: { day: '24', time: '03:05' } })

    // The evidence must be the first session, not just any line about the account.
    const later = { kind: 'pin', text: 'pike\tttyn1\tAug 27\t02:40\t540', source: 'terminal' } as const
    expect(session.answer('evidence', later).correct).toBe(false)
    const first = { kind: 'pin', text: 'pike\tttyn1\tAug 24\t03:05\t420', source: 'terminal' } as const
    expect(session.answer('evidence', first).correct).toBe(true)
  })

  it('rebuilds the same level from its recorded events', () => {
    const session = start(0)
    investigate(session)
    session.answer('account', { kind: 'fill', values: { account: 'pike' } })

    const replay = start(0)
    for (const event of session.events) replay.apply(event)
    expect(replay.getState()).toEqual(session.getState())
    expect(showing(replay)).toBe('log:time')
  })
})

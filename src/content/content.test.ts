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

/**
 * Play the terminal part of a level, typing one of `lines` at each prompt in
 * place of the suggestion and pressing Continue whenever someone speaks.
 * Stops at the logbook, or at the first line that does not satisfy its prompt.
 */
function play(session: LevelSession, lines: readonly string[]): void {
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

/**
 * Play the terminal part of a level by typing exactly what is suggested.
 * Every suggestion must run without complaint and move the level on.
 * Returns the lines typed.
 */
function followSuggestions(session: LevelSession): string[] {
  session.begin()
  const suggested: string[] = []
  for (let guard = 0; guard < 100; guard++) {
    const beat = session.getState().beat
    if (!beat || 'log' in beat) return suggested
    if ('say' in beat) {
      session.continue()
      continue
    }
    const line = showing(session)
    suggested.push(line)
    const record = session.run(line)
    expect(record.output.filter((c) => c.stream === 'err'), line).toEqual([])
    expect(showing(session), `after: ${line}`).not.toBe(line)
  }
  throw new Error('the level did not reach its logbook')
}

beforeEach(() => {
  game = loadGame(contentSource)
})

describe('the world', () => {
  it('loads, with granite as the only host so far', () => {
    expect(game.game.title).toBe('Line Noise')
    expect(game.hosts.map((h) => h.name)).toEqual(['granite'])
    expect(game.levels.map((l) => l.level.id)).toEqual([
      'L01-the-discrepancy',
      'L02-the-account-nobody-opened',
    ])
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

describe('every guided level', () => {
  it('explains both what each command does and what its output means', () => {
    for (const { level } of game.levels.filter((l) => l.level.mode === 'guided')) {
      for (const beat of level.beats) {
        if (!('prompt' in beat)) continue
        expect(beat.prompt.explain.trim(), `${level.id}: ${beat.prompt.run}`).not.toBe('')
        expect(beat.prompt.result?.trim() ?? '', `${level.id}: ${beat.prompt.run} has no result`).not.toBe('')
      }
    }
  })

  it('says under every blank what goes in it, and where to look for it', () => {
    for (const { level } of game.levels.filter((l) => l.level.mode === 'guided')) {
      for (const entry of level.logbook) {
        if (!('fill' in entry)) continue
        for (const [name, blank] of Object.entries(entry.blanks)) {
          expect(blank.label, `${level.id} ${entry.id}.${name} label`).toBeTruthy()
          expect(blank.hint, `${level.id} ${entry.id}.${name} hint`).toBeTruthy()
        }
      }
    }
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

  const investigate = (session: LevelSession, lines: readonly string[] = SUGGESTED): void =>
    play(session, lines)

  function fillLogbook(session: LevelSession): void {
    session.answer('account', { kind: 'fill', values: { account: 'pike' } })
    session.answer('time', { kind: 'fill', values: { sessions: '3', minutes: '23', amount: '1.15' } })
    session.answer('first', { kind: 'fill', values: { day: '24', time: '03:05' } })
    session.answer('evidence', { kind: 'pin', text: 'pike\tttyn1\tAug 24\t03:05\t420', source: 'terminal' })
  }

  it('suggests each command in turn, and each suggestion does its job', () => {
    const session = start(0)
    expect(followSuggestions(session)).toEqual(SUGGESTED)
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

describe('Level 2: The Account Nobody Opened', () => {
  const SUGGESTED = [
    'grep pike /etc/passwd',
    'ls /usr/local/billing/requests',
    'ls -l /etc/passwd',
    'last pike',
    'last ttyn1',
    'finger hollis',
    'ls -l /usr/adm/usage.log',
    'grep hollis /usr/adm/usage.log',
    'grep ttyn1 /usr/adm/gateway.log',
  ]

  /** Seconds since 1970 for a time in 1986 on a host's own clock. */
  const at = (month: string, day: number, hour: number, minute: number): number =>
    Date.UTC(1986, ['Aug', 'Sep'].indexOf(month) + 7, day, hour, minute) / 1000

  function fillTimeline(session: LevelSession): void {
    session.answer('dormant', { kind: 'fill', values: { time: '02:14', account: 'hollis' } })
    session.answer('created', { kind: 'fill', values: { time: '02:31' } })
    session.answer('first-use', { kind: 'fill', values: { day: '24', time: '03:05' } })
    session.answer('gateway', { kind: 'fill', values: { gateway: '02:53', corrected: '02:47' } })
    session.answer('edit', { kind: 'fill', values: { time: '03:02', owner: 'root' } })
  }

  it('starts after lunch the same day, with the morning in the login records', () => {
    const session = start(1)
    expect(out(session, 'date')).toBe('Tue Sep  2 13:10:00 PDT 1986\n')
    expect(out(session, 'last ops')).toMatch(/^ops\s+ttyh4\s+Tue Sep  2 08:40 - 12:05/m)
    expect(out(session, 'who')).toMatch(/^ops\s+ttyh4\s+Sep  2 13:10/m)
  })

  it('rests on facts that hold in the world', () => {
    const fs = buildWorld(game, 1, programs).host('granite').fs
    const logins = fs
      .peek('/usr/adm/wtmp')!
      .trim()
      .split('\n')
      .map((line) => line.split(':'))
      .map(([user, tty, from, login, logout]) => ({ user, tty, from, login: Number(login), logout: Number(logout) }))
    const network = logins.filter((l) => l.tty === 'ttyn1')

    // Only two accounts ever used the network line, always through the gateway, always at night.
    expect([...new Set(network.map((l) => l.user))].sort()).toEqual(['hollis', 'pike'])
    for (const l of network) {
      expect(l.from).toBe('shale')
      expect(new Date(l.login * 1000).getUTCHours()).toBeLessThan(4)
    }

    // The password file changed inside a hollis session, before pike's first login.
    const changed = fs.inspect('/etc/passwd')!.mtime
    expect(changed).toBe(at('Aug', 22, 2, 31))
    expect(network.some((l) => l.user === 'hollis' && l.login < changed && changed < l.logout)).toBe(true)
    expect(Math.min(...network.filter((l) => l.user === 'pike').map((l) => l.login))).toBeGreaterThan(changed)

    // The usage log changed while hollis was the only one logged in, and it is root's alone to write.
    const edited = fs.inspect('/usr/adm/usage.log')!
    expect(edited.mtime).toBe(at('Sep', 1, 3, 2))
    expect(edited.uid).toBe(0)
    expect(edited.mode & 0o022).toBe(0)
    expect(logins.filter((l) => l.login < edited.mtime && edited.mtime < l.logout).map((l) => l.user)).toEqual([
      'hollis',
    ])

    // hollis is in the login records and gone from the usage log; pike was left in.
    const usage = fs.peek('/usr/adm/usage.log')!
    expect(usage).not.toContain('hollis')
    expect(usage.match(/^pike/gm)).toHaveLength(3)

    // Every login on the network line is a call in the gateway's log, six minutes later by its clock.
    const calls = fs
      .peek('/usr/adm/gateway.log')!
      .split('\n')
      .filter((line) => line.includes('granite ttyn1'))
      .map((line) => {
        const [month, day, clock, direction] = line.split(/\s+/)
        const [hour, minute] = clock!.split(':').map(Number)
        return { time: at(month!, Number(day), hour!, minute!), direction }
      })
    expect(calls.map((c) => c.time)).toEqual(network.map((l) => l.login + 6 * 60))
    expect(calls.every((c) => c.direction === 'IN')).toBe(true)
  })

  it('suggests each command in turn, and each suggestion does its job', () => {
    const session = start(1)
    expect(followSuggestions(session)).toEqual(SUGGESTED)
    expect(showing(session)).toBe('log:dormant')
  })

  it('puts each note in the tray when it becomes relevant', () => {
    const session = start(1)
    const tray = (): string[] => session.getState().tray.map((t) => t.id)
    play(session, SUGGESTED.slice(0, 4))
    expect(tray()).toEqual([])
    session.run('last ttyn1')
    expect(tray()).toEqual(['hollis-note'])
    session.continue()
    session.run('finger hollis')
    session.continue()
    session.run('ls -l /usr/adm/usage.log')
    session.run('grep hollis /usr/adm/usage.log')
    expect(tray()).toEqual(['hollis-note'])
    session.continue()
    expect(tray()).toEqual(['hollis-note', 'clock-note'])
  })

  it('can be played from briefing to debrief', () => {
    const session = start(1)
    play(session, SUGGESTED)
    fillTimeline(session)
    expect(showing(session)).toBe('log:suspects')
    session.answer('suspects', { kind: 'choose', chosen: ['pike', 'hollis'] })
    const listing = session.commandRecords
      .find((r) => r.line === 'ls -l /usr/adm/usage.log')!
      .output.map((c) => c.text)
      .join('')
      .trimEnd()
    session.answer('root-proof', { kind: 'pin', text: listing, source: 'terminal' })
    expect(showing(session)).toBe('say')
    session.continue()

    const state = session.getState()
    expect(state.objectives.filter((o) => !o.met)).toEqual([])
    expect(state.phase).toBe('debrief')
    expect(session.loaded.card.title).toBe('Dormant accounts and drifting clocks')
  })

  it('accepts other ways of doing each step', () => {
    const session = start(1)
    play(session, [
      'cat /etc/passwd',
      'cd /usr/local/billing; ls -l requests',
      'ls -l /etc',
      'last | grep pike',
      'last | grep shale',
      'finger hollis pike',
      'ls -lt /usr/adm',
      'grep -c hollis /usr/adm/usage.log',
      'cat /usr/adm/gateway.log',
    ])
    expect(`${showing(session)} (last line: ${session.commandRecords.at(-1)?.line})`).toBe(
      'log:dormant (last line: cat /usr/adm/gateway.log)',
    )
    expect(session.getState().objectives.filter((o) => !o.met).map((o) => o.id)).toEqual(['lined-up'])
  })

  it('wants the timeline on granite time, not the gateway clock', () => {
    const session = start(1)
    play(session, SUGGESTED)

    // The gateway's own time for the first call is six minutes late.
    const late = session.answer('dormant', { kind: 'fill', values: { time: '02:20', account: 'hollis' } })
    expect(late.blanks).toEqual({ time: false, account: true })
    expect(late.hint).toContain('not the gateway')
    session.answer('dormant', { kind: 'fill', values: { time: '2:14 am', account: 'Hollis' } })
    session.answer('created', { kind: 'fill', values: { time: '02:31' } })
    session.answer('first-use', { kind: 'fill', values: { day: '24', time: '03:05' } })

    // Adding the six minutes instead of taking them off.
    const added = session.answer('gateway', { kind: 'fill', values: { gateway: '02:53', corrected: '02:59' } })
    expect(added.blanks).toEqual({ gateway: true, corrected: false })
    expect(added.hint).toContain('take six minutes off')
    expect(session.answer('gateway', { kind: 'fill', values: { gateway: '02:53', corrected: '02:47' } }).correct).toBe(
      true,
    )
    expect(session.getState().objectives.find((o) => o.id === 'lined-up')?.met).toBe(true)
  })

  it('tells logging in as root apart from having its authority', () => {
    const session = start(1)
    play(session, SUGGESTED)
    fillTimeline(session)
    const wrong = session.answer('suspects', { kind: 'choose', chosen: ['pike', 'root'] })
    expect(wrong).toMatchObject({ correct: false, hint: expect.stringContaining('not the same as logging in as root') })
    expect(session.answer('suspects', { kind: 'choose', chosen: ['hollis', 'pike'] }).correct).toBe(true)
  })

  it('takes either changed file as proof, and nothing else', () => {
    const pin = (text: string): boolean => {
      const session = start(1)
      play(session, SUGGESTED)
      fillTimeline(session)
      session.answer('suspects', { kind: 'choose', chosen: ['hollis', 'pike'] })
      return session.answer('root-proof', { kind: 'pin', text, source: 'terminal' }).correct
    }
    expect(pin('-rw-r--r--  1 root     wheel       5569 Sep  1 03:02 /usr/adm/usage.log')).toBe(true)
    expect(pin('-rw-r--r--  1 root     wheel       5569 Sep  1 03:02 usage.log')).toBe(true)
    expect(pin('-rw-r--r--  1 root     wheel        799 Aug 22 02:31 /etc/passwd')).toBe(true)
    expect(pin('hollis    ttyn1    shale            Mon Sep  1 02:47 - 03:05  (00:18)')).toBe(false)
    expect(pin('-rw-r--r--  1 marge    staff       1154 Sep  2 11:40 gateway.log')).toBe(false)
  })
})

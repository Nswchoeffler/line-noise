// Clock, time formatting, login records and hosts.

import { describe, expect, it } from 'vitest'
import { ROOT } from '../vfs/index.ts'
import { Clock } from './clock.ts'
import { Host } from './host.ts'
import { formatLogins, parseLogins } from './logins.ts'
import {
  formatClock,
  formatDate,
  formatDuration,
  formatListTime,
  formatLoginTime,
  formatShortTime,
  parseTime,
  yearOf,
} from './time.ts'

describe('Clock', () => {
  it('starts where it is told and only moves when advanced', () => {
    const clock = new Clock(1000)
    expect(clock.now).toBe(1000)
    clock.advance(60)
    expect(clock.now).toBe(1060)
  })

  it('tells listeners the new and previous time', () => {
    const clock = new Clock(1000)
    const seen: [number, number][] = []
    const stop = clock.onAdvance((now, previous) => seen.push([now, previous]))
    clock.advance(5)
    clock.advance(10)
    stop()
    clock.advance(1)
    expect(seen).toEqual([
      [1005, 1000],
      [1015, 1005],
    ])
  })

  it('ignores an advance of zero and refuses to run backwards', () => {
    const clock = new Clock(1000)
    let calls = 0
    clock.onAdvance(() => calls++)
    clock.advance(0)
    expect(calls).toBe(0)
    expect(() => clock.advance(-1)).toThrow(RangeError)
    expect(() => clock.advance(Number.NaN)).toThrow(RangeError)
    expect(clock.now).toBe(1000)
  })
})

describe('time', () => {
  const t = parseTime('1986-09-09 08:15:02')

  it('parses dates with and without a time', () => {
    expect(parseTime('1970-01-01 00:00')).toBe(0)
    expect(parseTime('1970-01-02')).toBe(86400)
    expect(parseTime('1986-09-09T08:15:02')).toBe(t)
    expect(parseTime('1986-09-09 08:15')).toBe(t - 2)
  })

  it('rejects text that is not a time', () => {
    expect(() => parseTime('yesterday')).toThrow('not a time')
    expect(() => parseTime('9/9/86')).toThrow('not a time')
  })

  it('formats like date', () => {
    expect(formatDate(t, 'PDT')).toBe('Tue Sep  9 08:15:02 PDT 1986')
    expect(formatDate(parseTime('1986-12-25 23:59:59'), 'PST')).toBe('Thu Dec 25 23:59:59 PST 1986')
  })

  it('formats like ls -l: time for recent files, year for old or future ones', () => {
    expect(formatListTime(parseTime('1986-09-09 03:02'), t)).toBe('Sep  9 03:02')
    expect(formatListTime(parseTime('1986-04-01 12:00'), t)).toBe('Apr  1 12:00')
    expect(formatListTime(parseTime('1985-08-12 14:00'), t)).toBe('Aug 12  1985')
    expect(formatListTime(parseTime('1986-10-01 00:00'), t)).toBe('Oct  1  1986')
  })

  it('formats login times and clocks', () => {
    expect(formatLoginTime(t)).toBe('Tue Sep  9 08:15')
    expect(formatShortTime(t)).toBe('Sep  9 08:15')
    expect(formatClock(t)).toBe('08:15')
    expect(yearOf(t)).toBe(1986)
  })

  it('formats session lengths', () => {
    expect(formatDuration(0)).toBe('00:00')
    expect(formatDuration(37 * 60)).toBe('00:37')
    expect(formatDuration(37 * 60 + 59)).toBe('00:37')
    expect(formatDuration(8.5 * 3600)).toBe('08:30')
    expect(formatDuration(27 * 3600 + 5 * 60)).toBe('1+03:05')
  })
})

describe('login records', () => {
  const RECORDS = [
    { user: 'bob', tty: 'ttyh3', from: 'farnet', login: 100, logout: 200 },
    { user: 'alice', tty: 'ttyp0', from: '', login: 300 },
  ]
  const TEXT = 'bob:ttyh3:farnet:100:200\nalice:ttyp0::300:\n'

  it('formats one line per login', () => {
    expect(formatLogins(RECORDS)).toBe(TEXT)
  })

  it('parses what it formats', () => {
    expect(parseLogins(TEXT)).toEqual(RECORDS)
  })

  it('skips blank and malformed lines', () => {
    const messy = '\nnot a record\nbob:ttyh3:farnet:soon:200\n:ttyh3::100:\nbob:tty::100:never\n' + TEXT
    expect(parseLogins(messy)).toEqual(RECORDS)
  })
})

describe('Host', () => {
  function makeHost(): Host {
    const host = new Host({ name: 'box', clock: new Clock(5000), timezone: 'PST' })
    host.fs.install('/etc/passwd', { content: 'root:x:0:0:Root:/:/bin/sh\nann:x:7:7:Ann:/home/ann:/bin/sh\n' })
    host.fs.install('/etc/group', { content: 'wheel:*:0:root\nusers:*:7:\n' })
    host.processes = [{ pid: 1, uid: 0, tty: null, stat: 'S', time: '0:01', command: 'init' }]
    return host
  }

  it('stamps files with its clock', () => {
    const host = makeHost()
    host.clock.advance(100)
    host.fs.writeFile('/etc/motd', 'hi\n', ROOT)
    expect(host.fs.stat('/etc/motd', ROOT).mtime).toBe(5100)
  })

  it('reads its accounts from /etc/passwd and /etc/group', () => {
    const host = makeHost()
    expect(host.users.byName('ann')?.uid).toBe(7)
    expect(host.users.groupName(7)).toBe('users')
  })

  it('sees account changes as soon as the file changes', () => {
    const host = makeHost()
    const before = host.users
    expect(host.users).toBe(before) // cached while the files are unchanged
    host.fs.writeFile('/etc/passwd', 'zed:x:9:7:Zed:/home/zed:/bin/sh\n', ROOT, { append: true })
    expect(host.users.byName('zed')?.uid).toBe(9)
  })

  it('has no accounts when the files are missing', () => {
    const host = new Host({ name: 'bare', clock: new Clock(0) })
    expect(host.users.users).toEqual([])
    expect(host.users.userName(0)).toBe('0')
    expect(host.timezone).toBe('UTC')
  })

  it('does not report its own bookkeeping reads as file access', () => {
    const host = makeHost()
    const events: unknown[] = []
    host.fs.subscribe((e) => events.push(e))
    void host.users
    expect(events).toEqual([])
  })

  it('round-trips through plain data', () => {
    const host = makeHost()
    const data = JSON.parse(JSON.stringify(host.serialize()))
    const restored = Host.deserialize(data, host.clock)
    expect(restored.serialize()).toEqual(host.serialize())
    expect(restored.users.byName('ann')?.home).toBe('/home/ann')
  })

  it('clones into an independent host that shares the clock', () => {
    const host = makeHost()
    const copy = host.clone('sandbox')
    expect(copy.name).toBe('sandbox')
    expect(copy.timezone).toBe('PST')

    copy.fs.writeFile('/etc/motd', 'only in the copy\n', ROOT)
    copy.processes.push({ pid: 2, uid: 7, tty: 'p0', stat: 'R', time: '0:00', command: 'sh' })
    expect(host.fs.tryStat('/etc/motd', ROOT)).toBeUndefined()
    expect(host.processes).toHaveLength(1)

    host.clock.advance(60)
    copy.fs.writeFile('/etc/later', 'x', ROOT)
    expect(copy.fs.stat('/etc/later', ROOT).mtime).toBe(5060)
  })
})

import { describe, expect, it } from 'vitest'
import { programs } from '../shell/commands/index.ts'
import { Shell } from '../shell/session.ts'
import { ROOT } from '../vfs/index.ts'
import { applyOverlay, buildHost } from './build.ts'
import { Clock } from './clock.ts'
import type { Host } from './host.ts'
import { HostSpecSchema, ModeSchema, OverlaySpecSchema, parseSpec, TimeSchema } from './spec.ts'
import { parseTime } from './time.ts'
import { World } from './world.ts'

// Written the way content files are: plain data, as it comes out of YAML.
const RAW_HOST = {
  name: 'box',
  timezone: 'PDT',
  installed: '1985-03-01 12:00',
  groups: [
    { name: 'wheel', gid: 0, members: ['root'] },
    { name: 'staff', gid: 10 },
  ],
  users: [
    { name: 'root', uid: 0, group: 'wheel', gecos: 'System Administrator', home: '/' },
    { name: 'ann', uid: 101, group: 'staff', gecos: 'Ann Example, Rm 4', password: 'Qx7hashhashAb' },
    { name: 'ben', uid: 102, group: 'staff' },
  ],
  dirs: [
    { path: '/tmp', mode: '1777' },
    { path: '/home/ann/private', owner: 'ann', mode: 700 },
  ],
  files: [
    { path: '/usr/adm/usage.log', mode: '644', mtime: '1986-09-09 03:02', content: 'ann ttyh1 1200\n' },
    { path: '/usr/local/bin/helper', mode: '4755', content: 'mv $1 $2\n' },
    { path: '/home/ann/notes', owner: 'ann', content: 'hello\n' },
    { path: '/usr/local/bin/rsh', program: 'sh', mode: '4755' },
  ],
  logins: [
    { user: 'ben', tty: 'ttyh3', from: 'farnet', login: '1986-09-09 02:14', logout: '1986-09-09 02:51' },
    { user: 'ann', tty: 'ttyp0', login: '1986-09-08 08:00', logout: '1986-09-08 17:00' },
  ],
  processes: [{ pid: 1, user: 'root', command: 'init' }],
}

function build(raw: unknown = RAW_HOST): Host {
  const spec = parseSpec(HostSpecSchema, raw, 'test host')
  return buildHost(spec, { clock: new Clock(parseTime('1986-09-09 08:15')), programs })
}

describe('spec values', () => {
  it('reads modes as octal, quoted or not', () => {
    expect(ModeSchema.parse('644')).toBe(0o644)
    expect(ModeSchema.parse('4755')).toBe(0o4755)
    expect(ModeSchema.parse(755)).toBe(0o755)
    expect(ModeSchema.safeParse('999').success).toBe(false)
    expect(ModeSchema.safeParse('rw-r--r--').success).toBe(false)
  })

  it('reads times', () => {
    expect(TimeSchema.parse('1986-09-09 08:15')).toBe(parseTime('1986-09-09 08:15'))
    expect(TimeSchema.safeParse('last Tuesday').success).toBe(false)
  })

  it('explains what is wrong, naming the file and the field', () => {
    const bad = { ...RAW_HOST, files: [{ path: 'relative', mode: '999', colour: 'red' }] }
    let message = ''
    try {
      parseSpec(HostSpecSchema, bad, 'world/box.yaml')
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toContain('world/box.yaml is not valid')
    expect(message).toContain('files')
    expect(message).toContain('colour')
    expect(message).toContain('three or four octal digits')
  })
})

describe('buildHost', () => {
  it('writes /etc/passwd and /etc/group from the user list', () => {
    const host = build()
    expect(host.fs.readFile('/etc/passwd', ROOT)).toBe(
      [
        'root:*:0:0:System Administrator:/:/bin/sh',
        'ann:Qx7hashhashAb:101:10:Ann Example, Rm 4:/home/ann:/bin/sh',
        'ben:*:102:10::/home/ben:/bin/sh',
        '',
      ].join('\n'),
    )
    expect(host.fs.readFile('/etc/group', ROOT)).toBe('wheel:*:0:root\nstaff:*:10:\n')
    expect(host.fs.stat('/etc/passwd', ROOT)).toMatchObject({ mode: 0o644, uid: 0 })
  })

  it('creates a home directory for each user, owned by them', () => {
    const host = build()
    expect(host.fs.stat('/home/ben', ROOT)).toMatchObject({ kind: 'dir', uid: 102, gid: 10, mode: 0o755 })
  })

  it('installs the commands', () => {
    const host = build()
    expect(host.fs.stat('/bin/ls', ROOT)).toMatchObject({
      program: 'ls',
      mode: 0o755,
      mtime: parseTime('1985-03-01 12:00'),
    })
  })

  it('installs files with owner, group, mode and time', () => {
    const host = build()
    expect(host.fs.stat('/usr/adm/usage.log', ROOT)).toMatchObject({
      uid: 0,
      gid: 0,
      mode: 0o644,
      mtime: parseTime('1986-09-09 03:02'),
    })
    expect(host.fs.stat('/usr/local/bin/helper', ROOT).mode).toBe(0o4755)
    expect(host.fs.stat('/home/ann/notes', ROOT)).toMatchObject({ uid: 101, gid: 10, mode: 0o644 })
    expect(host.fs.stat('/home/ann/notes', ROOT).mtime).toBe(parseTime('1985-03-01 12:00'))
  })

  it('installs directories', () => {
    const host = build()
    expect(host.fs.stat('/tmp', ROOT).mode).toBe(0o1777)
    expect(host.fs.stat('/home/ann/private', ROOT)).toMatchObject({ uid: 101, mode: 0o700 })
  })

  it('installs a file as a copy of a command', () => {
    const host = build()
    expect(host.fs.stat('/usr/local/bin/rsh', ROOT)).toMatchObject({ program: 'sh', mode: 0o4755 })
  })

  it('writes login records in time order', () => {
    const host = build()
    const shell = Shell.login({ host, programs, user: 'ann' })
    const out = shell.run('last').output[0]!.text
    expect(out.indexOf('ben')).toBeLessThan(out.indexOf('ann'))
    expect(out).toContain('ben       ttyh3    farnet           Tue Sep  9 02:14 - 02:51  (00:37)')
  })

  it('fills the process table, resolving user names', () => {
    expect(build().processes).toEqual([
      { pid: 1, uid: 0, tty: null, stat: 'S', time: '0:00', command: 'init' },
    ])
  })

  it('produces a host a user can log in to and work on', () => {
    const host = build()
    const shell = Shell.login({ host, programs, user: 'ann', tty: 'ttyp0' })
    expect(shell.cwd).toBe('/home/ann')
    expect(shell.run('cat notes').output).toEqual([{ stream: 'out', text: 'hello\n' }])
    expect(shell.run('echo x > /usr/adm/usage.log').status).toBe(1)
  })

  it('lets an explicit /etc/passwd replace the generated one', () => {
    const custom = 'root:*:0:0::/:/bin/sh\n'
    const host = build({ ...RAW_HOST, dirs: [], logins: [], files: [{ path: '/etc/passwd', content: custom }] })
    expect(host.fs.readFile('/etc/passwd', ROOT)).toBe(custom)
  })

  it('rejects owners, groups and commands that do not exist', () => {
    const withFile = (file: object): unknown => ({ ...RAW_HOST, files: [file] })
    expect(() => build(withFile({ path: '/x', owner: 'ghost' }))).toThrow('no such user "ghost"')
    expect(() => build(withFile({ path: '/x', group: 'ghosts' }))).toThrow('no such group "ghosts"')
    expect(() => build(withFile({ path: '/x', program: 'emacs' }))).toThrow('not a command installed')
    expect(() =>
      build({ ...RAW_HOST, users: [{ name: 'x', uid: 5, group: 'nogroup' }] }),
    ).toThrow('no such group "nogroup"')
  })

  it('builds the same host from the same description', () => {
    expect(build().serialize()).toEqual(build().serialize())
  })
})

describe('applyOverlay', () => {
  const overlay = (raw: unknown) => parseSpec(OverlaySpecSchema, raw, 'test overlay')

  it('adds and replaces files', () => {
    const host = build()
    applyOverlay(
      host,
      overlay({
        files: [
          { path: '/usr/adm/usage.log', content: 'changed\n', mtime: '1986-09-09 03:05' },
          { path: '/home/ann/new', owner: 'ann', content: 'new\n' },
        ],
      }),
    )
    expect(host.fs.readFile('/usr/adm/usage.log', ROOT)).toBe('changed\n')
    expect(host.fs.stat('/home/ann/new', ROOT).uid).toBe(101)
  })

  it('sets when an existing file was last changed, leaving its contents alone', () => {
    const host = build({
      ...RAW_HOST,
      touch: [{ path: '/etc/passwd', mtime: '1986-08-22 02:31' }],
    })
    // The generated account list keeps its content and gets its place in the story.
    expect(host.fs.stat('/etc/passwd', ROOT).mtime).toBe(parseTime('1986-08-22 02:31'))
    expect(host.fs.readFile('/etc/passwd', ROOT)).toContain('ann:Qx7hashhashAb:101:10:')

    applyOverlay(host, overlay({ touch: [{ path: '/home/ann/notes', mtime: '1986-09-01 03:02' }] }))
    expect(host.fs.stat('/home/ann/notes', ROOT).mtime).toBe(parseTime('1986-09-01 03:02'))
    expect(host.fs.readFile('/home/ann/notes', ROOT)).toBe('hello\n')
  })

  it('refuses to set the time of something that is not there', () => {
    const host = build()
    expect(() =>
      applyOverlay(host, overlay({ touch: [{ path: '/no/such/file', mtime: '1986-09-01 03:02' }] })),
    ).toThrow('touch /no/such/file: nothing there on box')
  })

  it('refuses a file whose separate content was never read in', () => {
    const host = build()
    expect(() => applyOverlay(host, overlay({ files: [{ path: '/data/long', file: 'world/files/long.txt' }] }))).toThrow(
      'has not been read in',
    )
  })

  it('removes files and whole directories, ignoring paths that are not there', () => {
    const host = build()
    applyOverlay(host, overlay({ remove: ['/home/ann', '/usr/local/bin/helper', '/no/such/path'] }))
    expect(host.fs.tryStat('/home/ann', ROOT)).toBeUndefined()
    expect(host.fs.tryStat('/usr/local/bin/helper', ROOT)).toBeUndefined()
  })

  it('merges new logins into the records, keeping time order', () => {
    const host = build()
    applyOverlay(
      host,
      overlay({ logins: [{ user: 'ann', tty: 'ttyp0', login: '1986-09-09 08:02' }] }),
    )
    const shell = Shell.login({ host, programs, user: 'ann' })
    expect(shell.run('who').output[0]!.text).toBe('ann      ttyp0    Sep  9 08:02\n')
    expect(shell.run('last | grep -c tty').output[0]!.text).toBe('3\n')
  })

  it('adds, replaces and ends processes', () => {
    const host = build()
    applyOverlay(
      host,
      overlay({
        processes: [
          { pid: 1, user: 'root', command: 'init (restarted)' },
          { pid: 77, user: 'ben', tty: 'h3', stat: 'R', time: '0:02', command: 'sh' },
        ],
      }),
    )
    expect(host.processes.map((p) => [p.pid, p.command])).toEqual([
      [1, 'init (restarted)'],
      [77, 'sh'],
    ])
    applyOverlay(host, overlay({ endProcesses: [77] }))
    expect(host.processes.map((p) => p.pid)).toEqual([1])
  })

  it('does not report its changes as file access', () => {
    const host = build()
    const events: unknown[] = []
    host.fs.subscribe((e) => events.push(e))
    applyOverlay(host, overlay({ remove: ['/home/ann/notes'], files: [{ path: '/etc/motd' }] }))
    expect(events).toEqual([])
  })
})

describe('World', () => {
  it('holds hosts on one clock', () => {
    const world = new World(1000)
    const spec = parseSpec(HostSpecSchema, RAW_HOST, 'test host')
    const box = world.add(buildHost(spec, { clock: world.clock, programs }))
    world.add(box.clone('sandbox'))
    expect(world.hosts.map((h) => h.name)).toEqual(['box', 'sandbox'])
    expect(world.host('sandbox').clock).toBe(world.clock)
    expect(world.has('nowhere')).toBe(false)
    expect(() => world.host('nowhere')).toThrow('no such host')
  })

  it('refuses a host on another clock', () => {
    const world = new World(1000)
    expect(() => world.add(build())).toThrow('different clock')
  })

  it('round-trips through plain data', () => {
    const world = new World(1000)
    const spec = parseSpec(HostSpecSchema, RAW_HOST, 'test host')
    world.add(buildHost(spec, { clock: world.clock, programs }))
    world.clock.advance(500)
    const restored = World.deserialize(JSON.parse(JSON.stringify(world.serialize())))
    expect(restored.clock.now).toBe(1500)
    expect(restored.serialize()).toEqual(world.serialize())
  })
})

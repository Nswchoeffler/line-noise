import { beforeEach, describe, expect, it } from 'vitest'
import {
  ROOT,
  S_ISUID,
  VfsError,
  type AccessEvent,
  type Credentials,
  type VfsErrorCode,
} from './types.ts'
import { Vfs } from './vfs.ts'

// A small cast. Group 10 is "staff"; group 20 is "ops".
const ALICE: Credentials = { uid: 101, gid: 10, groups: [10] }
const BOB: Credentials = { uid: 102, gid: 10, groups: [10] }
const CAROL: Credentials = { uid: 103, gid: 30, groups: [30] }
const DAVE: Credentials = { uid: 104, gid: 30, groups: [30, 10] } // staff as a secondary group

let clock: number
let fs: Vfs

/** Assert that `fn` throws a VfsError with the given code. */
function expectCode(fn: () => unknown, code: VfsErrorCode): void {
  let caught: unknown
  try {
    fn()
  } catch (err) {
    caught = err
  }
  expect(caught, `expected ${code} to be thrown`).toBeInstanceOf(VfsError)
  expect((caught as VfsError).code).toBe(code)
}

beforeEach(() => {
  clock = 1000
  fs = new Vfs({ now: () => clock })
  fs.installDir('/tmp', { mode: 0o1777 })
  fs.installDir('/home/alice', { uid: ALICE.uid, gid: 10, mode: 0o755 })
  fs.installDir('/home/bob', { uid: BOB.uid, gid: 10, mode: 0o755 })
  fs.install('/etc/passwd', { content: 'root:x:0:0\n', mode: 0o644 })
  fs.install('/home/alice/notes', { content: 'hello\n', uid: ALICE.uid, gid: 10, mode: 0o644 })
})

describe('a new filesystem', () => {
  it('has a root directory owned by root, mode 755', () => {
    const stat = new Vfs({ now: () => 5 }).stat('/', ROOT)
    expect(stat).toMatchObject({ kind: 'dir', mode: 0o755, uid: 0, gid: 0, mtime: 5 })
  })

  it('requires absolute paths', () => {
    expectCode(() => fs.stat('etc/passwd', ROOT), 'EINVAL')
  })
})

describe('install (privileged setup)', () => {
  it('creates parent directories owned by root', () => {
    fs.install('/usr/local/bin/tool', { content: 'x' })
    expect(fs.stat('/usr/local/bin', ROOT)).toMatchObject({ kind: 'dir', uid: 0, mode: 0o755 })
  })

  it('sets exact owner, group, mode and modified time', () => {
    fs.install('/usr/local/bin/tool', {
      content: 'abc',
      uid: 7,
      gid: 8,
      mode: 0o4755,
      mtime: 42,
    })
    expect(fs.stat('/usr/local/bin/tool', ROOT)).toEqual({
      kind: 'file',
      mode: 0o4755,
      uid: 7,
      gid: 8,
      mtime: 42,
      size: 3,
    })
  })

  it('replaces an existing file', () => {
    fs.install('/etc/passwd', { content: 'new\n' })
    expect(fs.readFile('/etc/passwd', ROOT)).toBe('new\n')
  })

  it('records compiled programs with a reported size', () => {
    fs.install('/bin/ls', { program: 'ls', size: 14336, mode: 0o755 })
    expect(fs.stat('/bin/ls', ROOT)).toMatchObject({ program: 'ls', size: 14336 })
  })

  it('refuses to put a file where a directory is, or the reverse', () => {
    expectCode(() => fs.install('/home/alice'), 'EISDIR')
    expectCode(() => fs.installDir('/etc/passwd/sub'), 'ENOTDIR')
  })

  it('installDir updates the metadata of an existing directory', () => {
    fs.installDir('/home/alice', { mode: 0o700 })
    expect(fs.stat('/home/alice', ROOT)).toMatchObject({ mode: 0o700, uid: ALICE.uid })
  })
})

describe('lookup errors', () => {
  it('reports a missing file', () => {
    expectCode(() => fs.stat('/etc/nothing', ALICE), 'ENOENT')
    expectCode(() => fs.readFile('/nowhere/at/all', ALICE), 'ENOENT')
  })

  it('reports a file used as a directory', () => {
    expectCode(() => fs.stat('/etc/passwd/x', ALICE), 'ENOTDIR')
  })

  it('carries the path and a period message', () => {
    try {
      fs.stat('/etc/nothing', ALICE)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(VfsError)
      expect((err as VfsError).path).toBe('/etc/nothing')
      expect((err as VfsError).message).toBe('No such file or directory')
    }
  })

  it('tryStat returns undefined only for missing paths', () => {
    expect(fs.tryStat('/etc/nothing', ALICE)).toBeUndefined()
    expect(fs.tryStat('/etc/passwd/x', ALICE)).toBeUndefined()
    expect(fs.tryStat('/etc/passwd', ALICE)?.kind).toBe('file')
    fs.installDir('/vault', { mode: 0o700 })
    fs.install('/vault/secret')
    expectCode(() => fs.tryStat('/vault/secret', ALICE), 'EACCES')
  })
})

describe('read permission', () => {
  beforeEach(() => {
    fs.install('/home/alice/owner-only', { content: 'o', uid: ALICE.uid, gid: 10, mode: 0o600 })
    fs.install('/home/alice/group-read', { content: 'g', uid: ALICE.uid, gid: 10, mode: 0o640 })
    fs.install('/home/alice/world-read', { content: 'w', uid: ALICE.uid, gid: 10, mode: 0o644 })
  })

  it('lets the owner read an owner-only file', () => {
    expect(fs.readFile('/home/alice/owner-only', ALICE)).toBe('o')
  })

  it('denies group members and strangers on an owner-only file', () => {
    expectCode(() => fs.readFile('/home/alice/owner-only', BOB), 'EACCES')
    expectCode(() => fs.readFile('/home/alice/owner-only', CAROL), 'EACCES')
  })

  it('lets group members, but not strangers, read a group-readable file', () => {
    expect(fs.readFile('/home/alice/group-read', BOB)).toBe('g')
    expectCode(() => fs.readFile('/home/alice/group-read', CAROL), 'EACCES')
  })

  it('counts secondary groups', () => {
    expect(fs.readFile('/home/alice/group-read', DAVE)).toBe('g')
  })

  it('lets anyone read a world-readable file', () => {
    expect(fs.readFile('/home/alice/world-read', CAROL)).toBe('w')
  })

  it('lets root read anything', () => {
    expect(fs.readFile('/home/alice/owner-only', ROOT)).toBe('o')
  })

  it('applies only the owner class to the owner, even when others have more', () => {
    // Mode 044: the owner has nothing, everyone else may read.
    fs.install('/home/alice/odd', { content: 'x', uid: ALICE.uid, gid: 10, mode: 0o044 })
    expectCode(() => fs.readFile('/home/alice/odd', ALICE), 'EACCES')
    expect(fs.readFile('/home/alice/odd', BOB)).toBe('x')
    expect(fs.readFile('/home/alice/odd', CAROL)).toBe('x')
  })

  it('applies only the group class to group members, even when others have more', () => {
    fs.install('/home/alice/odd', { content: 'x', uid: ALICE.uid, gid: 10, mode: 0o604 })
    expectCode(() => fs.readFile('/home/alice/odd', BOB), 'EACCES')
    expect(fs.readFile('/home/alice/odd', CAROL)).toBe('x')
  })

  it('refuses to read a directory as a file', () => {
    expectCode(() => fs.readFile('/home/alice', ALICE), 'EISDIR')
  })
})

describe('directory search and list permission', () => {
  beforeEach(() => {
    fs.installDir('/vault', { uid: ALICE.uid, gid: 10, mode: 0o700 })
    fs.install('/vault/secret', { content: 's', uid: ALICE.uid, gid: 10, mode: 0o644 })
  })

  it('blocks access to a readable file inside a closed directory', () => {
    expectCode(() => fs.readFile('/vault/secret', BOB), 'EACCES')
    expectCode(() => fs.stat('/vault/secret', BOB), 'EACCES')
    expect(fs.readFile('/vault/secret', ALICE)).toBe('s')
  })

  it('checks every directory on the way down', () => {
    fs.installDir('/vault/deep/deeper', { mode: 0o755 })
    fs.install('/vault/deep/deeper/file', { content: 'd', mode: 0o644 })
    expectCode(() => fs.readFile('/vault/deep/deeper/file', BOB), 'EACCES')
  })

  it('with search but not read, files can be opened by name but not listed', () => {
    fs.chmod('/vault', 0o711, ALICE)
    expect(fs.readFile('/vault/secret', BOB)).toBe('s')
    expectCode(() => fs.readdir('/vault', BOB), 'EACCES')
  })

  it('with read but not search, names can be listed but files not opened', () => {
    fs.chmod('/vault', 0o744, ALICE)
    expect(fs.readdir('/vault', BOB)).toEqual(['secret'])
    expectCode(() => fs.readFile('/vault/secret', BOB), 'EACCES')
  })

  it('lists names in sorted order', () => {
    fs.install('/vault/b')
    fs.install('/vault/a')
    expect(fs.readdir('/vault', ALICE)).toEqual(['a', 'b', 'secret'])
  })

  it('refuses to list a file', () => {
    expectCode(() => fs.readdir('/etc/passwd', ALICE), 'ENOTDIR')
  })

  it('lets root through closed directories', () => {
    fs.chmod('/vault', 0o000, ALICE)
    expect(fs.readFile('/vault/secret', ROOT)).toBe('s')
    expect(fs.readdir('/vault', ROOT)).toEqual(['secret'])
  })
})

describe('access', () => {
  it('answers without throwing', () => {
    expect(fs.access('/home/alice/notes', ALICE, 'w')).toBe(true)
    expect(fs.access('/home/alice/notes', BOB, 'w')).toBe(false)
    expect(fs.access('/home/alice/notes', BOB, 'r')).toBe(true)
    expect(fs.access('/no/such/file', BOB, 'r')).toBe(false)
  })

  it('lets root execute a file only if someone has execute permission', () => {
    fs.install('/bin/tool', { mode: 0o644 })
    expect(fs.access('/bin/tool', ROOT, 'x')).toBe(false)
    fs.chmod('/bin/tool', 0o700, ROOT)
    expect(fs.access('/bin/tool', ROOT, 'x')).toBe(true)
  })

  it('always lets root search a directory', () => {
    fs.installDir('/locked', { mode: 0o000 })
    expect(fs.access('/locked', ROOT, 'x')).toBe(true)
  })
})

describe('writeFile', () => {
  it('creates a file owned by the caller, with the directory group and mode 644', () => {
    clock = 2000
    fs.writeFile('/home/alice/new', 'data', ALICE)
    expect(fs.stat('/home/alice/new', ALICE)).toEqual({
      kind: 'file',
      mode: 0o644,
      uid: ALICE.uid,
      gid: 10,
      mtime: 2000,
      size: 4,
    })
  })

  it('takes the group from the directory, not the caller (BSD behaviour)', () => {
    fs.writeFile('/tmp/scratch', 'x', CAROL)
    expect(fs.stat('/tmp/scratch', CAROL)).toMatchObject({ uid: CAROL.uid, gid: 0 })
  })

  it('honours a requested creation mode', () => {
    fs.writeFile('/home/alice/private', 'x', ALICE, { mode: 0o600 })
    expect(fs.stat('/home/alice/private', ALICE).mode).toBe(0o600)
  })

  it('needs write permission on the directory to create', () => {
    expectCode(() => fs.writeFile('/home/alice/intruder', 'x', BOB), 'EACCES')
    expectCode(() => fs.writeFile('/etc/shadow', 'x', ALICE), 'EACCES')
  })

  it('needs search permission as well as write on the directory', () => {
    fs.installDir('/dropbox', { uid: ALICE.uid, mode: 0o722 })
    expectCode(() => fs.writeFile('/dropbox/x', 'x', BOB), 'EACCES')
  })

  it('replaces content and updates the modified time', () => {
    clock = 3000
    fs.writeFile('/home/alice/notes', 'changed\n', ALICE)
    expect(fs.readFile('/home/alice/notes', ALICE)).toBe('changed\n')
    expect(fs.stat('/home/alice/notes', ALICE).mtime).toBe(3000)
  })

  it('appends when asked', () => {
    fs.writeFile('/home/alice/notes', 'more\n', ALICE, { append: true })
    expect(fs.readFile('/home/alice/notes', ALICE)).toBe('hello\nmore\n')
  })

  it('keeps owner and mode when overwriting', () => {
    fs.chmod('/home/alice/notes', 0o666, ALICE)
    fs.writeFile('/home/alice/notes', 'bob was here\n', BOB)
    expect(fs.stat('/home/alice/notes', ALICE)).toMatchObject({ uid: ALICE.uid, mode: 0o666 })
  })

  it('needs write permission on an existing file, whatever the directory allows', () => {
    expectCode(() => fs.writeFile('/home/alice/notes', 'x', BOB), 'EACCES')
    // Bob can create in /tmp, but cannot overwrite Alice's read-only file there.
    fs.writeFile('/tmp/alices', 'a', ALICE)
    expectCode(() => fs.writeFile('/tmp/alices', 'b', BOB), 'EACCES')
  })

  it('lets a writer change a file in a directory they cannot write', () => {
    fs.install('/etc/motd', { content: 'old', mode: 0o666 })
    fs.writeFile('/etc/motd', 'new', ALICE)
    expect(fs.readFile('/etc/motd', ALICE)).toBe('new')
  })

  it('lets root write anywhere', () => {
    fs.writeFile('/home/alice/notes', 'root\n', ROOT)
    fs.writeFile('/etc/new', 'x', ROOT)
    expect(fs.readFile('/home/alice/notes', ROOT)).toBe('root\n')
  })

  it('refuses to write over a directory', () => {
    expectCode(() => fs.writeFile('/home/alice', 'x', ALICE), 'EISDIR')
  })

  it('fails when the parent directory does not exist', () => {
    expectCode(() => fs.writeFile('/home/alice/sub/file', 'x', ALICE), 'ENOENT')
  })

  it('updates the directory modified time on create but not on overwrite', () => {
    clock = 4000
    fs.writeFile('/home/alice/notes', 'x', ALICE)
    expect(fs.stat('/home/alice', ALICE).mtime).toBe(1000)
    fs.writeFile('/home/alice/fresh', 'x', ALICE)
    expect(fs.stat('/home/alice', ALICE).mtime).toBe(4000)
  })
})

describe('setuid and write', () => {
  beforeEach(() => {
    fs.install('/tmp/helper', { content: 'old', uid: ALICE.uid, gid: 10, mode: 0o4777 })
  })

  it('clears setuid when anyone but root writes the file', () => {
    fs.writeFile('/tmp/helper', 'evil', BOB)
    expect(fs.stat('/tmp/helper', BOB).mode).toBe(0o777)
  })

  it('clears setuid even when the owner writes', () => {
    fs.writeFile('/tmp/helper', 'mine', ALICE)
    expect(fs.stat('/tmp/helper', ALICE).mode & S_ISUID).toBe(0)
  })

  it('keeps setuid when root writes', () => {
    fs.writeFile('/tmp/helper', 'patched', ROOT)
    expect(fs.stat('/tmp/helper', ROOT).mode).toBe(0o4777)
  })

  it('turns an overwritten compiled program into ordinary text', () => {
    fs.install('/tmp/prog', { program: 'ls', size: 9000, mode: 0o777 })
    fs.writeFile('/tmp/prog', 'echo hi\n', ALICE)
    const stat = fs.stat('/tmp/prog', ALICE)
    expect(stat.program).toBeUndefined()
    expect(stat.size).toBe(8)
  })
})

describe('mkdir', () => {
  it('creates a directory owned by the caller', () => {
    fs.mkdir('/home/alice/work', ALICE)
    expect(fs.stat('/home/alice/work', ALICE)).toMatchObject({
      kind: 'dir',
      uid: ALICE.uid,
      gid: 10,
      mode: 0o755,
    })
  })

  it('fails if the name is taken', () => {
    expectCode(() => fs.mkdir('/home/alice/notes', ALICE), 'EEXIST')
    expectCode(() => fs.mkdir('/home/alice', ALICE), 'EEXIST')
  })

  it('needs write permission on the parent', () => {
    expectCode(() => fs.mkdir('/home/alice/bobs', BOB), 'EACCES')
  })

  it('refuses to create the root', () => {
    expectCode(() => fs.mkdir('/', ROOT), 'EINVAL')
  })
})

describe('unlink', () => {
  it('removes a file', () => {
    fs.unlink('/home/alice/notes', ALICE)
    expectCode(() => fs.stat('/home/alice/notes', ALICE), 'ENOENT')
  })

  it('is decided by the directory: a read-only file in your own directory can go', () => {
    fs.install('/home/alice/roots', { uid: 0, gid: 0, mode: 0o600 })
    fs.unlink('/home/alice/roots', ALICE)
    expect(fs.tryStat('/home/alice/roots', ALICE)).toBeUndefined()
  })

  it('is decided by the directory: your own file in a closed directory cannot go', () => {
    fs.install('/etc/alices', { uid: ALICE.uid, mode: 0o666 })
    expectCode(() => fs.unlink('/etc/alices', ALICE), 'EACCES')
  })

  it('refuses directories and missing files', () => {
    expectCode(() => fs.unlink('/home/alice', ROOT), 'EISDIR')
    expectCode(() => fs.unlink('/home/alice/ghost', ALICE), 'ENOENT')
  })

  it('updates the directory modified time', () => {
    clock = 5000
    fs.unlink('/home/alice/notes', ALICE)
    expect(fs.stat('/home/alice', ALICE).mtime).toBe(5000)
  })
})

describe('sticky directories', () => {
  beforeEach(() => {
    fs.writeFile('/tmp/alices', 'a', ALICE)
  })

  it('let anyone create files', () => {
    fs.writeFile('/tmp/bobs', 'b', BOB)
    expect(fs.readFile('/tmp/bobs', ALICE)).toBe('b')
  })

  it('stop one user removing another user\'s file', () => {
    expectCode(() => fs.unlink('/tmp/alices', BOB), 'EPERM')
  })

  it('stop one user renaming another user\'s file', () => {
    expectCode(() => fs.rename('/tmp/alices', '/tmp/stolen', BOB), 'EPERM')
  })

  it('stop one user replacing another user\'s file by rename', () => {
    fs.writeFile('/tmp/bobs', 'b', BOB)
    expectCode(() => fs.rename('/tmp/bobs', '/tmp/alices', BOB), 'EPERM')
  })

  it('let the owner and root remove the file', () => {
    fs.unlink('/tmp/alices', ALICE)
    fs.writeFile('/tmp/alices', 'a', ALICE)
    fs.unlink('/tmp/alices', ROOT)
    expect(fs.tryStat('/tmp/alices', ROOT)).toBeUndefined()
  })

  it('without the sticky bit, a world-writable directory lets anyone remove anything', () => {
    fs.installDir('/open', { mode: 0o777 })
    fs.writeFile('/open/alices', 'a', ALICE)
    fs.unlink('/open/alices', BOB)
    expect(fs.tryStat('/open/alices', ROOT)).toBeUndefined()
  })
})

describe('rmdir', () => {
  it('removes an empty directory', () => {
    fs.mkdir('/home/alice/work', ALICE)
    fs.rmdir('/home/alice/work', ALICE)
    expect(fs.tryStat('/home/alice/work', ALICE)).toBeUndefined()
  })

  it('refuses a directory with anything in it', () => {
    expectCode(() => fs.rmdir('/home/alice', ROOT), 'ENOTEMPTY')
  })

  it('refuses files and missing paths', () => {
    expectCode(() => fs.rmdir('/home/alice/notes', ALICE), 'ENOTDIR')
    expectCode(() => fs.rmdir('/home/alice/ghost', ALICE), 'ENOENT')
  })

  it('needs write permission on the parent', () => {
    fs.mkdir('/home/alice/work', ALICE)
    expectCode(() => fs.rmdir('/home/alice/work', BOB), 'EACCES')
  })
})

describe('rename', () => {
  it('moves a file and keeps its owner, mode and modified time', () => {
    fs.install('/home/alice/script', {
      content: 'echo hi\n',
      uid: ALICE.uid,
      gid: 10,
      mode: 0o750,
      mtime: 77,
    })
    clock = 6000
    fs.rename('/home/alice/script', '/tmp/script', ALICE)
    expect(fs.tryStat('/home/alice/script', ALICE)).toBeUndefined()
    expect(fs.stat('/tmp/script', ALICE)).toMatchObject({
      uid: ALICE.uid,
      gid: 10,
      mode: 0o750,
      mtime: 77,
    })
    expect(fs.stat('/tmp', ALICE).mtime).toBe(6000)
    expect(fs.stat('/home/alice', ALICE).mtime).toBe(6000)
  })

  it('replaces an existing file at the destination', () => {
    fs.install('/home/alice/a', { content: 'A', uid: ALICE.uid })
    fs.install('/home/alice/b', { content: 'B', uid: ALICE.uid })
    fs.rename('/home/alice/a', '/home/alice/b', ALICE)
    expect(fs.readFile('/home/alice/b', ALICE)).toBe('A')
    expect(fs.readdir('/home/alice', ALICE)).toEqual(['b', 'notes'])
  })

  it('needs write permission on the source directory', () => {
    expectCode(() => fs.rename('/home/alice/notes', '/tmp/notes', BOB), 'EACCES')
  })

  it('needs write permission on the destination directory', () => {
    expectCode(() => fs.rename('/home/alice/notes', '/etc/notes', ALICE), 'EACCES')
    expect(fs.readFile('/home/alice/notes', ALICE)).toBe('hello\n')
  })

  it('lets root place a user\'s file over a system file, keeping the user as owner', () => {
    // The heart of the Level 3 replay: whoever can write the directory decides
    // what the name points to, regardless of who owns the file being replaced.
    fs.install('/usr/lib/job', { content: 'real\n', uid: 0, mode: 0o755 })
    fs.install('/home/alice/fake', { content: 'fake\n', uid: ALICE.uid, gid: 10, mode: 0o755 })
    expectCode(() => fs.rename('/home/alice/fake', '/usr/lib/job', ALICE), 'EACCES')
    fs.rename('/home/alice/fake', '/usr/lib/job', ROOT)
    expect(fs.readFile('/usr/lib/job', ROOT)).toBe('fake\n')
    expect(fs.stat('/usr/lib/job', ROOT).uid).toBe(ALICE.uid)
  })

  it('moves a directory with its contents', () => {
    fs.mkdir('/home/alice/work', ALICE)
    fs.writeFile('/home/alice/work/todo', 't', ALICE)
    fs.rename('/home/alice/work', '/tmp/work', ALICE)
    expect(fs.readFile('/tmp/work/todo', ALICE)).toBe('t')
  })

  it('refuses to move a directory inside itself', () => {
    fs.mkdir('/home/alice/work', ALICE)
    expectCode(() => fs.rename('/home/alice/work', '/home/alice/work/sub', ALICE), 'EINVAL')
  })

  it('refuses mismatched kinds and non-empty directory targets', () => {
    fs.mkdir('/home/alice/work', ALICE)
    fs.mkdir('/home/alice/full', ALICE)
    fs.writeFile('/home/alice/full/x', 'x', ALICE)
    expectCode(() => fs.rename('/home/alice/notes', '/home/alice/work', ALICE), 'EISDIR')
    expectCode(() => fs.rename('/home/alice/work', '/home/alice/notes', ALICE), 'ENOTDIR')
    expectCode(() => fs.rename('/home/alice/work', '/home/alice/full', ALICE), 'ENOTEMPTY')
  })

  it('does nothing when source and destination are the same', () => {
    fs.rename('/home/alice/notes', '/home/alice/./notes', ALICE)
    expect(fs.readFile('/home/alice/notes', ALICE)).toBe('hello\n')
  })

  it('reports a missing source', () => {
    expectCode(() => fs.rename('/home/alice/ghost', '/tmp/ghost', ALICE), 'ENOENT')
  })
})

describe('chmod', () => {
  it('lets the owner change the mode', () => {
    fs.chmod('/home/alice/notes', 0o600, ALICE)
    expect(fs.stat('/home/alice/notes', ALICE).mode).toBe(0o600)
  })

  it('lets root change any mode', () => {
    fs.chmod('/home/alice/notes', 0o4755, ROOT)
    expect(fs.stat('/home/alice/notes', ROOT).mode).toBe(0o4755)
  })

  it('refuses everyone else with "Not owner", even with write permission', () => {
    fs.chmod('/home/alice/notes', 0o666, ALICE)
    expectCode(() => fs.chmod('/home/alice/notes', 0o777, BOB), 'EPERM')
    try {
      fs.chmod('/home/alice/notes', 0o777, BOB)
    } catch (err) {
      expect((err as VfsError).message).toBe('Not owner')
    }
  })

  it('stops a user removing setuid from a root-owned program', () => {
    fs.install('/usr/local/bin/helper', { uid: 0, mode: 0o4755 })
    expectCode(() => fs.chmod('/usr/local/bin/helper', 0o755, ALICE), 'EPERM')
    fs.chmod('/usr/local/bin/helper', 0o755, ROOT)
    expect(fs.stat('/usr/local/bin/helper', ALICE).mode).toBe(0o755)
  })

  it('does not change the modified time', () => {
    clock = 7000
    fs.chmod('/home/alice/notes', 0o600, ALICE)
    expect(fs.stat('/home/alice/notes', ALICE).mtime).toBe(1000)
  })

  it('keeps only real mode bits', () => {
    fs.chmod('/home/alice/notes', 0o170644, ALICE)
    expect(fs.stat('/home/alice/notes', ALICE).mode).toBe(0o644)
  })
})

describe('chown', () => {
  it('is for root only', () => {
    expectCode(() => fs.chown('/home/alice/notes', BOB.uid, 10, ALICE), 'EPERM')
    fs.chown('/home/alice/notes', BOB.uid, 30, ROOT)
    expect(fs.stat('/home/alice/notes', ROOT)).toMatchObject({ uid: BOB.uid, gid: 30 })
  })

  it('clears setuid and setgid', () => {
    fs.install('/tmp/prog', { mode: 0o6755 })
    fs.chown('/tmp/prog', ALICE.uid, 10, ROOT)
    expect(fs.stat('/tmp/prog', ROOT).mode).toBe(0o755)
  })
})

describe('events', () => {
  it('reports successful operations with a normalized path and the caller', () => {
    const events: AccessEvent[] = []
    fs.subscribe((e) => events.push(e))
    fs.readFile('/home/alice/../alice/notes', ALICE)
    fs.readdir('/home/alice', BOB)
    fs.writeFile('/home/alice/notes', 'x', ALICE)
    fs.writeFile('/home/alice/new', 'x', ALICE)
    fs.chmod('/home/alice/new', 0o600, ALICE)
    fs.unlink('/home/alice/new', ALICE)
    expect(events).toEqual([
      { op: 'read', path: '/home/alice/notes', uid: ALICE.uid },
      { op: 'list', path: '/home/alice', uid: BOB.uid },
      { op: 'write', path: '/home/alice/notes', uid: ALICE.uid },
      { op: 'create', path: '/home/alice/new', uid: ALICE.uid },
      { op: 'chmod', path: '/home/alice/new', uid: ALICE.uid },
      { op: 'remove', path: '/home/alice/new', uid: ALICE.uid },
    ])
  })

  it('reports nothing for failed operations', () => {
    const events: AccessEvent[] = []
    fs.subscribe((e) => events.push(e))
    expectCode(() => fs.writeFile('/home/alice/notes', 'x', BOB), 'EACCES')
    expectCode(() => fs.readFile('/nope', ALICE), 'ENOENT')
    expect(events).toEqual([])
  })

  it('stops reporting after unsubscribe', () => {
    const events: AccessEvent[] = []
    const stop = fs.subscribe((e) => events.push(e))
    stop()
    fs.readFile('/home/alice/notes', ALICE)
    expect(events).toEqual([])
  })

  it('does not report privileged setup', () => {
    const events: AccessEvent[] = []
    fs.subscribe((e) => events.push(e))
    fs.install('/etc/hosts', { content: 'x' })
    fs.installDir('/var/spool')
    expect(events).toEqual([])
  })
})

describe('snapshot and clone', () => {
  it('round-trips the whole tree', () => {
    fs.install('/bin/ls', { program: 'ls', size: 14336, mode: 0o755, mtime: 9 })
    fs.install('/usr/local/bin/helper', { content: 'mv $1 $2\n', mode: 0o4755 })
    const restored = Vfs.fromSnapshot(fs.snapshot(), { now: () => clock })
    expect(restored.snapshot()).toEqual(fs.snapshot())
    expect(restored.stat('/bin/ls', ROOT)).toEqual(fs.stat('/bin/ls', ROOT))
    expect(restored.readFile('/home/alice/notes', ALICE)).toBe('hello\n')
    expect(restored.stat('/tmp', ROOT).mode).toBe(0o1777)
  })

  it('survives JSON, which is how saves are stored', () => {
    const json = JSON.stringify(fs.snapshot())
    const restored = Vfs.fromSnapshot(JSON.parse(json), { now: () => clock })
    expect(restored.snapshot()).toEqual(fs.snapshot())
  })

  it('serializes equal trees identically, whatever order files were made in', () => {
    const a = new Vfs({ now: () => 1 })
    a.install('/x/one')
    a.install('/x/two')
    const b = new Vfs({ now: () => 1 })
    b.install('/x/two')
    b.install('/x/one')
    expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()))
  })

  it('makes clones independent in both directions', () => {
    const copy = fs.clone()
    copy.writeFile('/home/alice/notes', 'copy\n', ALICE)
    fs.writeFile('/home/alice/original-only', 'x', ALICE)
    expect(fs.readFile('/home/alice/notes', ALICE)).toBe('hello\n')
    expect(copy.tryStat('/home/alice/original-only', ALICE)).toBeUndefined()
  })

  it('still enforces permissions in a clone', () => {
    const copy = fs.clone()
    expectCode(() => copy.writeFile('/etc/passwd', 'x', ALICE), 'EACCES')
  })

  it('lets a clone run on its own clock', () => {
    const copy = fs.clone({ now: () => 99999 })
    copy.writeFile('/tmp/x', 'x', ALICE)
    expect(copy.stat('/tmp/x', ALICE).mtime).toBe(99999)
  })

  it('rejects a snapshot whose root is not a directory', () => {
    expect(() =>
      Vfs.fromSnapshot(
        { kind: 'file', mode: 0o644, uid: 0, gid: 0, mtime: 0, content: '' },
        { now: () => 0 },
      ),
    ).toThrow(VfsError)
  })
})

describe('system-only access', () => {
  it('peek and inspect ignore permissions and report no events', () => {
    fs.installDir('/vault', { mode: 0o000 })
    fs.install('/vault/secret', { content: 's', mode: 0o000 })
    const events: AccessEvent[] = []
    fs.subscribe((e) => events.push(e))
    expect(fs.peek('/vault/secret')).toBe('s')
    expect(fs.inspect('/vault/secret')).toMatchObject({ kind: 'file', mode: 0 })
    expect(fs.inspect('/vault')?.kind).toBe('dir')
    expect(events).toEqual([])
  })

  it('peek and inspect return undefined for what is not there', () => {
    expect(fs.peek('/nope')).toBeUndefined()
    expect(fs.peek('/home/alice')).toBeUndefined()
    expect(fs.peek('/etc/passwd/x')).toBeUndefined()
    expect(fs.inspect('/nope')).toBeUndefined()
  })

  it('uninstall removes files and whole directories without events', () => {
    const events: AccessEvent[] = []
    fs.subscribe((e) => events.push(e))
    expect(fs.uninstall('/home/alice/notes')).toBe(true)
    expect(fs.uninstall('/home')).toBe(true)
    expect(fs.inspect('/home/bob')).toBeUndefined()
    expect(events).toEqual([])
  })

  it('uninstall reports nothing to remove, and never removes the root', () => {
    expect(fs.uninstall('/nope')).toBe(false)
    expect(fs.uninstall('/etc/passwd/x')).toBe(false)
    expect(fs.uninstall('/')).toBe(false)
    expect(fs.inspect('/etc/passwd')).toBeDefined()
  })
})

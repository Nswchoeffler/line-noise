// cp, mv, rm and chmod: the commands that change files.

import { beforeEach, describe, expect, it } from 'vitest'
import { ROOT } from '../../vfs/index.ts'
import { fixture, type Fixture } from '../testing.ts'

let t: Fixture

const stat = (path: string) => t.host.fs.stat(path, ROOT)
const exists = (path: string): boolean => t.host.fs.tryStat(path, ROOT) !== undefined
const read = (path: string): string => t.host.fs.readFile(path, ROOT)

beforeEach(() => {
  t = fixture()
  t.run('echo alpha > a; echo beta > b')
  t.host.fs.installDir('/home/alice/dir', { uid: 101, gid: 10 })
  t.host.fs.install('/etc/motd', { content: 'welcome\n', mode: 0o644 })
})

describe('cp', () => {
  it('copies a file', () => {
    expect(t.run('cp a copy')).toMatchObject({ stdout: '', stderr: '', status: 0 })
    expect(read('/home/alice/copy')).toBe('alpha\n')
    expect(read('/home/alice/a')).toBe('alpha\n')
  })

  it('replaces an existing destination', () => {
    t.run('cp a b')
    expect(read('/home/alice/b')).toBe('alpha\n')
  })

  it('copies into a directory, keeping the name', () => {
    t.run('cp a dir')
    expect(read('/home/alice/dir/a')).toBe('alpha\n')
  })

  it('copies several files into a directory', () => {
    t.run('cp a b dir')
    expect(t.run('ls dir | cat').stdout).toBe('a\nb\n')
  })

  it('needs a directory when given several files', () => {
    expect(t.run('cp a b c').stderr).toBe('cp: c: Not a directory\n')
  })

  it('makes the copier the owner of the copy', () => {
    t.run('cp /etc/motd mine')
    expect(stat('/home/alice/mine')).toMatchObject({ uid: 101, mode: 0o644 })
  })

  it('keeps permission bits but drops setuid', () => {
    t.host.fs.install('/usr/local/bin/tool', { content: 'echo hi\n', mode: 0o4755, uid: 0 })
    t.run('cp /usr/local/bin/tool mytool')
    expect(stat('/home/alice/mytool')).toMatchObject({ uid: 101, mode: 0o755 })
  })

  it('copies a compiled program so that the copy still runs', () => {
    t.run('cp /bin/echo myecho')
    expect(stat('/home/alice/myecho')).toMatchObject({ program: 'echo', uid: 101, mode: 0o755 })
    expect(t.run('./myecho works').stdout).toBe('works\n')
  })

  it('a copy of sh made by root and marked setuid is a root shell for anyone', () => {
    const root = t.login('root')
    root.run('cp /bin/sh /tmp/rootsh; chmod 4755 /tmp/rootsh')
    expect(stat('/tmp/rootsh')).toMatchObject({ uid: 0, mode: 0o4755, program: 'sh' })
    t.run('/tmp/rootsh')
    expect(t.run('whoami').stdout).toBe('root\n')
  })

  it('refuses a source the user may not read', () => {
    t.host.fs.install('/home/bob/diary', { content: 'private\n', uid: 102, gid: 10, mode: 0o600 })
    expect(t.run('cp /home/bob/diary stolen').stderr).toBe('cp: /home/bob/diary: Permission denied\n')
    expect(exists('/home/alice/stolen')).toBe(false)
  })

  it('refuses a destination the user may not write', () => {
    const result = t.run('cp a /etc/motd')
    expect(result.stderr).toBe('cp: a: Permission denied\n')
    expect(result.status).toBe(1)
    expect(read('/etc/motd')).toBe('welcome\n')
    expect(t.run('cp a /etc/new').status).toBe(1)
  })

  it('refuses directories and identical files', () => {
    expect(t.run('cp dir other').stderr).toBe('cp: dir: Is a directory (not copied)\n')
    expect(t.run('cp a a').stderr).toBe('cp: a and a are the same file (not copied)\n')
    expect(t.run('cp a ./a').stderr).toContain('same file')
  })

  it('reports a missing source', () => {
    expect(t.run('cp missing x').stderr).toBe('cp: missing: No such file or directory\n')
  })

  it('needs two arguments', () => {
    const result = t.run('cp a')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('usage: cp')
  })
})

describe('mv', () => {
  it('renames a file', () => {
    expect(t.run('mv a renamed').status).toBe(0)
    expect(exists('/home/alice/a')).toBe(false)
    expect(read('/home/alice/renamed')).toBe('alpha\n')
  })

  it('replaces an existing destination', () => {
    t.run('mv a b')
    expect(read('/home/alice/b')).toBe('alpha\n')
    expect(exists('/home/alice/a')).toBe(false)
  })

  it('moves into a directory', () => {
    t.run('mv a b dir')
    expect(t.run('ls dir | cat').stdout).toBe('a\nb\n')
  })

  it('renames a directory', () => {
    t.run('mv dir folder')
    expect(stat('/home/alice/folder').kind).toBe('dir')
  })

  it('keeps the owner and mode of the moved file', () => {
    t.run('chmod 600 a')
    t.run('mv a /tmp/a')
    expect(stat('/tmp/a')).toMatchObject({ uid: 101, mode: 0o600 })
  })

  it('refuses to move a file out of a directory the user cannot write', () => {
    const result = t.run('mv /etc/motd mine')
    expect(result.stderr).toBe('mv: /etc/motd: Permission denied\n')
    expect(result.status).toBe(1)
    expect(exists('/etc/motd')).toBe(true)
  })

  it('refuses to move a file into a directory the user cannot write', () => {
    expect(t.run('mv a /etc/a').stderr).toBe('mv: a: Permission denied\n')
    expect(exists('/home/alice/a')).toBe(true)
  })

  it('run by root, puts a user file over a system file', () => {
    t.login('root').run('mv /home/alice/a /etc/motd')
    expect(read('/etc/motd')).toBe('alpha\n')
    expect(stat('/etc/motd').uid).toBe(101)
  })

  it('reports a missing source', () => {
    expect(t.run('mv missing x').stderr).toBe('mv: missing: No such file or directory\n')
  })

  it('needs a directory when given several files', () => {
    expect(t.run('mv a b nowhere').stderr).toBe('mv: nowhere: Not a directory\n')
  })
})

describe('rm', () => {
  it('removes files', () => {
    expect(t.run('rm a b')).toMatchObject({ stderr: '', status: 0 })
    expect(exists('/home/alice/a')).toBe(false)
    expect(exists('/home/alice/b')).toBe(false)
  })

  it('reports a missing file', () => {
    const result = t.run('rm missing')
    expect(result.stderr).toBe('rm: missing: No such file or directory\n')
    expect(result.status).toBe(1)
  })

  it('stays quiet about a missing file with -f', () => {
    expect(t.run('rm -f missing')).toMatchObject({ stderr: '', status: 0 })
  })

  it('refuses a directory without -r', () => {
    expect(t.run('rm dir').stderr).toBe('rm: dir: Is a directory\n')
    expect(exists('/home/alice/dir')).toBe(true)
  })

  it('removes a directory tree with -r', () => {
    t.run('cp a dir; cp b dir')
    t.host.fs.installDir('/home/alice/dir/sub', { uid: 101, gid: 10 })
    t.run('cp a dir/sub')
    expect(t.run('rm -r dir').status).toBe(0)
    expect(exists('/home/alice/dir')).toBe(false)
  })

  it('refuses when the directory is not writable', () => {
    const result = t.run('rm /etc/motd')
    expect(result.stderr).toBe('rm: /etc/motd: Permission denied\n')
    expect(exists('/etc/motd')).toBe(true)
  })

  it('removes a read-only file from the user\'s own directory', () => {
    t.host.fs.install('/home/alice/locked', { uid: 0, mode: 0o444 })
    expect(t.run('rm locked').status).toBe(0)
  })

  it('cannot remove another user\'s file from /tmp', () => {
    t.login('bob').run('echo mine > /tmp/bobs')
    expect(t.run('rm /tmp/bobs').stderr).toBe('rm: /tmp/bobs: Not owner\n')
    expect(t.login('root').run('rm /tmp/bobs').status).toBe(0)
  })

  it('needs a file name', () => {
    expect(t.run('rm').stderr).toContain('usage: rm')
  })
})

describe('chmod', () => {
  it('sets an octal mode', () => {
    expect(t.run('chmod 600 a')).toMatchObject({ stderr: '', status: 0 })
    expect(stat('/home/alice/a').mode).toBe(0o600)
  })

  it('applies symbolic changes', () => {
    t.run('chmod +x a')
    expect(stat('/home/alice/a').mode).toBe(0o755)
    t.run('chmod go-rx a')
    expect(stat('/home/alice/a').mode).toBe(0o700)
    t.run('chmod -x a')
    expect(stat('/home/alice/a').mode).toBe(0o600)
  })

  it('changes several files', () => {
    t.run('chmod 640 a b')
    expect(stat('/home/alice/a').mode).toBe(0o640)
    expect(stat('/home/alice/b').mode).toBe(0o640)
  })

  it('makes a script runnable', () => {
    t.run("echo 'echo ran' > script")
    expect(t.run('./script').stderr).toContain('Permission denied')
    t.run('chmod +x script')
    expect(t.run('./script').stdout).toBe('ran\n')
  })

  it('takes effect at once on reading', () => {
    t.run('chmod 000 a')
    expect(t.run('cat a').stderr).toBe('cat: a: Permission denied\n')
    t.run('chmod 644 a')
    expect(t.run('cat a').stdout).toBe('alpha\n')
  })

  it('refuses a file the user does not own', () => {
    const result = t.run('chmod 777 /etc/motd')
    expect(result.stderr).toBe('chmod: /etc/motd: Not owner\n')
    expect(result.status).toBe(1)
    expect(stat('/etc/motd').mode).toBe(0o644)
  })

  it('lets only root strip setuid from a root-owned program', () => {
    t.host.fs.install('/usr/local/bin/helper', { content: 'mv $1 $2\n', mode: 0o4755, uid: 0 })
    expect(t.run('chmod u-s /usr/local/bin/helper').stderr).toBe(
      'chmod: /usr/local/bin/helper: Not owner\n',
    )
    expect(stat('/usr/local/bin/helper').mode).toBe(0o4755)
    expect(t.login('root').run('chmod u-s /usr/local/bin/helper').status).toBe(0)
    expect(stat('/usr/local/bin/helper').mode).toBe(0o755)
  })

  it('sets setuid with u+s or a four-digit mode', () => {
    t.run('chmod u+s a')
    expect(stat('/home/alice/a').mode).toBe(0o4644)
    t.run('chmod 4755 a')
    expect(stat('/home/alice/a').mode).toBe(0o4755)
  })

  it('reports a missing file', () => {
    expect(t.run('chmod 644 missing').stderr).toBe('chmod: missing: No such file or directory\n')
  })

  it('rejects a bad mode with a usage line', () => {
    const result = t.run('chmod banana a')
    expect(result.stderr).toBe(
      'chmod: invalid mode: banana\nusage: chmod mode file ...    (mode like 644, u+x, go-w or u-s)\n',
    )
    expect(result.status).toBe(2)
  })

  it('needs both a mode and a file', () => {
    expect(t.run('chmod 644').status).toBe(2)
    expect(t.run('chmod').status).toBe(2)
  })
})

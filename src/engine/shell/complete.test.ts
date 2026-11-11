import { beforeEach, describe, expect, it } from 'vitest'
import { completeLine } from './complete.ts'
import { fixture, type Fixture } from './testing.ts'

let t: Fixture

/** Complete with the cursor at the `^` mark, and show the result the same way. */
function complete(marked: string): { line: string; candidates: string[] } {
  const cursor = marked.indexOf('^')
  const line = marked.slice(0, cursor) + marked.slice(cursor + 1)
  const result = completeLine(t.shell.env, line, cursor)
  return {
    line: result.line.slice(0, result.cursor) + '^' + result.line.slice(result.cursor),
    candidates: result.candidates,
  }
}

beforeEach(() => {
  t = fixture()
  const own = { uid: 101, gid: 10 }
  t.host.fs.install('/home/alice/usage.log', own)
  t.host.fs.install('/home/alice/usage.old', own)
  t.host.fs.install('/home/alice/notes', own)
  t.host.fs.install('/home/alice/.plan', own)
  t.host.fs.installDir('/home/alice/work', own)
  t.host.fs.install('/home/alice/work/todo', own)
  t.host.fs.installDir('/vault', { mode: 0o700 })
  t.host.fs.install('/vault/secret')
})

describe('completing command names', () => {
  it('finishes a unique command and adds a space', () => {
    expect(complete('whoa^')).toEqual({ line: 'whoami ^', candidates: [] })
    expect(complete('hist^')).toEqual({ line: 'history ^', candidates: [] })
  })

  it('offers the choices when several commands match', () => {
    expect(complete('ch^')).toEqual({ line: 'chmod ^', candidates: [] })
    expect(complete('c^')).toEqual({
      line: 'c^',
      candidates: ['cat', 'cd', 'chmod', 'clear', 'cp', 'cut'],
    })
  })

  it('extends to the longest shared prefix', () => {
    expect(complete('w^')).toEqual({ line: 'w^', candidates: ['wc', 'who', 'whoami'] })
    expect(complete('wh^')).toEqual({ line: 'who^', candidates: ['who', 'whoami'] })
  })

  it('completes a command after a pipe or a semicolon', () => {
    expect(complete('cat notes | so^')).toEqual({ line: 'cat notes | sort ^', candidates: [] })
    expect(complete('pwd; whoa^')).toEqual({ line: 'pwd; whoami ^', candidates: [] })
    expect(complete('pwd;whoa^')).toEqual({ line: 'pwd;whoami ^', candidates: [] })
  })

  it('does nothing when no command matches', () => {
    expect(complete('zz^')).toEqual({ line: 'zz^', candidates: [] })
  })

  it('lists every command on an empty line', () => {
    const { candidates } = complete('^')
    expect(candidates).toContain('ls')
    expect(candidates).toContain('cd')
  })
})

describe('completing file names', () => {
  it('finishes a unique file and adds a space', () => {
    expect(complete('cat no^')).toEqual({ line: 'cat notes ^', candidates: [] })
  })

  it('finishes a directory with a slash, ready to look inside', () => {
    expect(complete('ls wo^')).toEqual({ line: 'ls work/^', candidates: [] })
    expect(complete('cat work/^')).toEqual({ line: 'cat work/todo ^', candidates: [] })
  })

  it('extends as far as the matches agree and offers the choices', () => {
    expect(complete('cat us^')).toEqual({
      line: 'cat usage.^',
      candidates: ['usage.log', 'usage.old'],
    })
    expect(complete('cat usage.l^')).toEqual({ line: 'cat usage.log ^', candidates: [] })
  })

  it('lists the directory when nothing is typed yet, without hidden files', () => {
    expect(complete('cat ^')).toEqual({
      line: 'cat ^',
      candidates: ['notes', 'usage.log', 'usage.old', 'work/'],
    })
  })

  it('offers hidden files once the dot is typed', () => {
    expect(complete('cat .p^')).toEqual({ line: 'cat .plan ^', candidates: [] })
  })

  it('completes absolute paths one level at a time', () => {
    expect(complete('ls /ho^')).toEqual({ line: 'ls /home/^', candidates: [] })
    expect(complete('ls /home/al^')).toEqual({ line: 'ls /home/alice/^', candidates: [] })
    expect(complete('cat /etc/pa^')).toEqual({ line: 'cat /etc/passwd ^', candidates: [] })
  })

  it('completes relative and home paths', () => {
    t.run('cd work')
    expect(complete('cat ../no^')).toEqual({ line: 'cat ../notes ^', candidates: [] })
    expect(complete('cat ~/no^')).toEqual({ line: 'cat ~/notes ^', candidates: [] })
    expect(complete('ls ~bob/^')).toEqual({ line: 'ls ~bob/^', candidates: [] })
  })

  it('completes the target of a redirect', () => {
    expect(complete('sort notes >no^')).toEqual({ line: 'sort notes >notes ^', candidates: [] })
    expect(complete('sort < us^').candidates).toEqual(['usage.log', 'usage.old'])
  })

  it('completes a program given by path in command position', () => {
    expect(complete('/bin/ech^')).toEqual({ line: '/bin/echo ^', candidates: [] })
  })

  it('completes in the middle of a line without disturbing the rest', () => {
    expect(complete('cat no^ | wc -l')).toEqual({ line: 'cat notes^ | wc -l', candidates: [] })
  })

  it('offers nothing from a directory the user cannot read', () => {
    expect(complete('cat /vault/^')).toEqual({ line: 'cat /vault/^', candidates: [] })
    const root = t.login('root')
    expect(completeLine(root.shell.env, 'cat /vault/', 11).line).toBe('cat /vault/secret ')
  })

  it('does nothing when no file matches', () => {
    expect(complete('cat zz^')).toEqual({ line: 'cat zz^', candidates: [] })
    expect(complete('cat /nowhere/x^')).toEqual({ line: 'cat /nowhere/x^', candidates: [] })
  })
})

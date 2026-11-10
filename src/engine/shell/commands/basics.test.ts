// echo, pwd, whoami, cat, clear and sh: the small commands.

import { beforeEach, describe, expect, it } from 'vitest'
import { fixture, type Fixture } from '../testing.ts'

let t: Fixture

beforeEach(() => {
  t = fixture()
})

describe('echo', () => {
  it('prints its arguments separated by single spaces', () => {
    expect(t.run('echo a   b  c').stdout).toBe('a b c\n')
  })

  it('prints an empty line with no arguments', () => {
    expect(t.run('echo').stdout).toBe('\n')
  })

  it('keeps spacing inside quotes', () => {
    expect(t.run('echo "a   b"').stdout).toBe('a   b\n')
  })

  it('omits the newline with -n', () => {
    expect(t.run('echo -n no newline').stdout).toBe('no newline')
  })

  it('works in a pipe and into a file', () => {
    expect(t.run('echo piped | cat').stdout).toBe('piped\n')
    t.run('echo line one > f; echo line two >> f')
    expect(t.run('cat f').stdout).toBe('line one\nline two\n')
  })
})

describe('pwd', () => {
  it('prints the working directory', () => {
    expect(t.run('pwd').stdout).toBe('/home/alice\n')
    t.run('cd /usr/adm')
    expect(t.run('pwd').stdout).toBe('/usr/adm\n')
  })

  it('works in a pipe', () => {
    expect(t.run('pwd | cat').stdout).toBe('/home/alice\n')
  })
})

describe('whoami', () => {
  it('prints the login name', () => {
    expect(t.run('whoami').stdout).toBe('alice\n')
    expect(t.login('root').run('whoami').stdout).toBe('root\n')
  })

  it('prints the effective user under setuid', () => {
    t.host.fs.install('/tmp/rootsh', { program: 'sh', mode: 0o4755, uid: 0 })
    t.run('/tmp/rootsh')
    expect(t.run('whoami').stdout).toBe('root\n')
  })

  it('prints the number when the account has no name', () => {
    t.host.fs.install('/tmp/ghost', { program: 'whoami', mode: 0o4755, uid: 777 })
    expect(t.run('/tmp/ghost').stdout).toBe('777\n')
  })

  it('works in a pipe', () => {
    expect(t.run('whoami | cat').stdout).toBe('alice\n')
  })
})

describe('cat', () => {
  beforeEach(() => {
    t.run('echo first > a; echo second > b')
  })

  it('prints a file', () => {
    expect(t.run('cat a').stdout).toBe('first\n')
  })

  it('joins several files in order', () => {
    expect(t.run('cat a b a').stdout).toBe('first\nsecond\nfirst\n')
  })

  it('passes piped input through', () => {
    expect(t.run('echo piped | cat').stdout).toBe('piped\n')
  })

  it('reads piped input for "-"', () => {
    expect(t.run('echo middle | cat a - b').stdout).toBe('first\nmiddle\nsecond\n')
  })

  it('reports a missing file and carries on', () => {
    const result = t.run('cat a missing b')
    expect(result.stdout).toBe('first\nsecond\n')
    expect(result.stderr).toBe('cat: missing: No such file or directory\n')
    expect(result.status).toBe(1)
  })

  it('reports a directory', () => {
    expect(t.run('cat /tmp').stderr).toBe('cat: /tmp: Is a directory\n')
  })

  it('refuses a file the user may not read', () => {
    t.host.fs.install('/home/bob/diary', { content: 'private\n', uid: 102, gid: 10, mode: 0o600 })
    const result = t.run('cat /home/bob/diary')
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('cat: /home/bob/diary: Permission denied\n')
    expect(t.login('bob').run('cat diary').stdout).toBe('private\n')
    expect(t.login('root').run('cat /home/bob/diary').stdout).toBe('private\n')
  })

  it('explains instead of waiting when there is nothing to read', () => {
    const result = t.run('cat')
    expect(result.stderr).toBe(
      'cat: nothing to read. Name a file, or pipe another command into cat.\n',
    )
    expect(result.status).toBe(1)
  })

  it('says so when asked to print a compiled program', () => {
    expect(t.run('cat /bin/ls').stderr).toBe('cat: /bin/ls: this is a compiled program, not text\n')
  })

  it('rejects unknown options with a usage line', () => {
    const result = t.run('cat -z a')
    expect(result.stderr).toBe('cat: unknown option -z\nusage: cat [file ...]\n')
    expect(result.status).toBe(2)
  })
})

describe('clear', () => {
  it('asks the terminal to wipe the screen', () => {
    const { record } = t.run('clear')
    expect(record.clear).toBe(true)
    expect(record.output).toEqual([])
  })
})

describe('sh', () => {
  it('runs a script file with arguments', () => {
    t.run("echo 'echo got $1' > script")
    expect(t.run('sh script value').stdout).toBe('got value\n')
  })

  it('reports a missing script', () => {
    const result = t.run('sh nothing')
    expect(result.stderr).toBe('sh: nothing: No such file or directory\n')
    expect(result.status).toBe(127)
  })

  it('runs a command string with -c', () => {
    expect(t.run('sh -c "echo one; echo two"').stdout).toBe('one\ntwo\n')
    expect(t.run('sh -c').stderr).toBe('sh: option -c needs a command\n')
  })

  it('runs commands piped into it', () => {
    expect(t.run('echo "echo from pipe" | sh').stdout).toBe('from pipe\n')
  })

  it('starts an interactive shell when run alone', () => {
    t.run('sh')
    expect(t.shell.depth).toBe(2)
    t.run('exit')
    expect(t.shell.depth).toBe(1)
  })
})

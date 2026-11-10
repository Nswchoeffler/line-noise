import { beforeEach, describe, expect, it } from 'vitest'
import { fixture, type Fixture } from './testing.ts'

let t: Fixture

beforeEach(() => {
  t = fixture()
})

describe('finding commands', () => {
  it('runs a program found on the PATH', () => {
    expect(t.run('echo hello')).toMatchObject({ stdout: 'hello\n', stderr: '', status: 0 })
  })

  it('runs a program given by its full path', () => {
    expect(t.run('/bin/echo hello').stdout).toBe('hello\n')
  })

  it('runs a program given by a relative path', () => {
    t.run('cd /bin')
    expect(t.run('./echo hello').stdout).toBe('hello\n')
  })

  it('reports an unknown command and points at help', () => {
    const result = t.run('frobnicate')
    expect(result.status).toBe(127)
    expect(result.stderr).toBe('frobnicate: Command not found. Type "help" to list the commands.\n')
  })

  it('suggests a near miss', () => {
    expect(t.run('ehco hi').stderr).toBe('ehco: Command not found. Did you mean "echo"?\n')
    expect(t.run('whoam').stderr).toContain('Did you mean "whoami"?')
  })

  it('does not find commands in the working directory unless asked with ./', () => {
    t.run('cd /bin')
    t.run('PATH=/nowhere')
    expect(t.run('echo hi').status).toBe(127)
    expect(t.run('./echo hi').stdout).toBe('hi\n')
  })

  it('says what is wrong with a bad path', () => {
    expect(t.run('/bin/nothing').stderr).toBe('/bin/nothing: No such file or directory\n')
    expect(t.run('/bin').stderr).toBe('/bin: Is a directory\n')
  })

  it('removing a program file removes the command', () => {
    t.host.fs.unlink('/bin/echo', { uid: 0, gid: 0, groups: [0] })
    expect(t.run('echo hi').status).toBe(127)
  })

  it('does nothing for a blank line', () => {
    expect(t.run('   ')).toMatchObject({ stdout: '', stderr: '', status: 0 })
  })

  it('reports syntax errors without running anything', () => {
    const result = t.run("echo 'oops")
    expect(result.stderr).toBe("Unmatched '.\n")
    expect(result.status).toBe(2)
    expect(result.record.commands).toEqual([])
  })
})

describe('execute permission', () => {
  beforeEach(() => {
    t.host.fs.install('/home/alice/script', {
      content: 'echo from script\n',
      uid: 101,
      gid: 10,
      mode: 0o644,
    })
  })

  it('refuses a file without execute permission', () => {
    const result = t.run('./script')
    expect(result.stderr).toBe('./script: Permission denied\n')
    expect(result.status).toBe(126)
  })

  it('runs a script once it is executable', () => {
    t.host.fs.chmod('/home/alice/script', 0o755, { uid: 101, gid: 10, groups: [10] })
    expect(t.run('./script').stdout).toBe('from script\n')
  })

  it('applies the execute bit per class', () => {
    t.host.fs.chmod('/home/alice/script', 0o750, { uid: 101, gid: 10, groups: [10] })
    expect(t.login('bob').run('/home/alice/script').stdout).toBe('from script\n')
    expect(t.login('carol').run('/home/alice/script').stderr).toContain('Permission denied')
  })

  it('needs read permission as well, for a script', () => {
    t.host.fs.chmod('/home/alice/script', 0o711, { uid: 101, gid: 10, groups: [10] })
    expect(t.login('bob').run('/home/alice/script').stderr).toBe(
      '/home/alice/script: Permission denied\n',
    )
  })
})

describe('pipes', () => {
  it('feeds one command into the next', () => {
    expect(t.run('echo hello | cat').stdout).toBe('hello\n')
    expect(t.run('echo hello | cat | cat | cat').stdout).toBe('hello\n')
  })

  it('reports the status of the last command', () => {
    expect(t.run('cat /nope | echo ok').status).toBe(0)
    expect(t.run('echo ok | cat /nope').status).toBe(1)
  })

  it('still shows errors from earlier stages', () => {
    const result = t.run('cat /nope | echo ok')
    expect(result.stderr).toBe('cat: /nope: No such file or directory\n')
    expect(result.stdout).toBe('ok\n')
  })

  it('tells a command whether its output goes to the screen', () => {
    // Recorded for later commands (ls prints columns only on a screen).
    const direct = t.run('echo hi')
    const piped = t.run('echo hi | cat')
    expect(direct.record.commands).toHaveLength(1)
    expect(piped.record.commands.map((c) => c.argv[0])).toEqual(['echo', 'cat'])
  })
})

describe('redirects', () => {
  it('writes output to a new file', () => {
    expect(t.run('echo saved > out').stdout).toBe('')
    expect(t.run('cat out').stdout).toBe('saved\n')
  })

  it('replaces an existing file with >', () => {
    t.run('echo one > out')
    t.run('echo two > out')
    expect(t.run('cat out').stdout).toBe('two\n')
  })

  it('adds to a file with >>', () => {
    t.run('echo one > out')
    t.run('echo two >> out')
    expect(t.run('cat out').stdout).toBe('one\ntwo\n')
  })

  it('creates the file with >> if it is missing', () => {
    t.run('echo first >> out')
    expect(t.run('cat out').stdout).toBe('first\n')
  })

  it('creates an empty file even when the command prints nothing', () => {
    t.run('cat /nope > out')
    expect(t.host.fs.readFile('/home/alice/out', { uid: 0, gid: 0, groups: [0] })).toBe('')
  })

  it('reads input from a file with <', () => {
    t.run('echo from file > in')
    expect(t.run('cat < in').stdout).toBe('from file\n')
  })

  it('combines input and output redirects', () => {
    t.run('echo data > in')
    t.run('cat < in > out')
    expect(t.run('cat out').stdout).toBe('data\n')
  })

  it('sends nothing down the pipe when output is redirected', () => {
    expect(t.run('echo hi > out | cat').stdout).toBe('')
  })

  it('empties the file before the command runs, as a real shell does', () => {
    t.run('echo precious > f')
    t.run('cat f > f')
    expect(t.run('cat f').stdout).toBe('')
  })

  it('fails with the right error when the file cannot be written', () => {
    const result = t.run('echo x > /etc/passwd')
    expect(result.stderr).toBe('/etc/passwd: Permission denied\n')
    expect(result.status).toBe(1)
    expect(t.run('echo x > /etc/newfile').stderr).toBe('/etc/newfile: Permission denied\n')
  })

  it('fails with the right error when the input file is missing', () => {
    const result = t.run('cat < missing')
    expect(result.stderr).toBe('missing: No such file or directory\n')
    expect(result.status).toBe(1)
  })

  it('does not run the command when a redirect fails', () => {
    const result = t.run('echo x > /etc/passwd')
    expect(result.record.commands).toEqual([
      { argv: ['echo', 'x'], path: null, status: 1, euid: 101, depth: 0 },
    ])
  })

  it('new files belong to the user and get mode 644', () => {
    t.run('echo x > out')
    expect(t.host.fs.stat('/home/alice/out', { uid: 0, gid: 0, groups: [0] })).toMatchObject({
      uid: 101,
      mode: 0o644,
    })
  })

  it('lets root redirect anywhere', () => {
    const root = t.login('root')
    expect(root.run('echo x > /etc/newfile').status).toBe(0)
  })
})

describe('sequences and variables', () => {
  it('runs commands separated by semicolons in order', () => {
    expect(t.run('echo one; echo two').stdout).toBe('one\ntwo\n')
  })

  it('keeps going after a failure', () => {
    const result = t.run('cat /nope; echo after')
    expect(result.stdout).toBe('after\n')
    expect(result.status).toBe(0)
  })

  it('sets and expands variables', () => {
    t.run('GREETING=hello')
    expect(t.run('echo $GREETING world').stdout).toBe('hello world\n')
  })

  it('provides HOME, USER and the last status', () => {
    expect(t.run('echo $HOME $USER').stdout).toBe('/home/alice alice\n')
    t.run('cat /nope')
    expect(t.run('echo $?').stdout).toBe('1\n')
    expect(t.run('echo $?').stdout).toBe('0\n')
  })

  it('expands wildcards against the real directory', () => {
    t.run('echo a > one.log; echo b > two.log; echo c > notes')
    expect(t.run('echo *.log').stdout).toBe('one.log two.log\n')
    expect(t.run('cat *.log').stdout).toBe('a\nb\n')
  })

  it('does not expand wildcards in a directory the user cannot list', () => {
    t.host.fs.installDir('/vault', { mode: 0o700 })
    t.host.fs.install('/vault/secret')
    expect(t.run('echo /vault/*').stdout).toBe('/vault/*\n')
    expect(t.login('root').run('echo /vault/*').stdout).toBe('/vault/secret\n')
  })
})

describe('cd', () => {
  it('starts in the home directory', () => {
    expect(t.run('pwd').stdout).toBe('/home/alice\n')
  })

  it('changes directory, absolute and relative', () => {
    t.run('cd /usr/adm')
    expect(t.run('pwd').stdout).toBe('/usr/adm\n')
    t.run('cd ..')
    expect(t.run('pwd').stdout).toBe('/usr\n')
    t.run('cd adm/../../tmp')
    expect(t.run('pwd').stdout).toBe('/tmp\n')
  })

  it('goes home with no argument', () => {
    t.run('cd /tmp')
    t.run('cd')
    expect(t.run('pwd').stdout).toBe('/home/alice\n')
  })

  it('reports a missing directory and stays put', () => {
    const result = t.run('cd /nowhere')
    expect(result.stderr).toBe('cd: /nowhere: No such file or directory\n')
    expect(result.status).toBe(1)
    expect(t.run('pwd').stdout).toBe('/home/alice\n')
  })

  it('refuses a file', () => {
    expect(t.run('cd /etc/passwd').stderr).toBe('cd: /etc/passwd: Not a directory\n')
  })

  it('refuses a directory without search permission', () => {
    t.host.fs.installDir('/vault', { mode: 0o700 })
    expect(t.run('cd /vault').stderr).toBe('cd: /vault: Permission denied\n')
    expect(t.login('root').run('cd /vault').status).toBe(0)
  })
})

describe('scripts', () => {
  const ALICE = { uid: 101, gid: 10, groups: [10] }

  function script(path: string, content: string, mode = 0o755): void {
    t.host.fs.install(path, { content, uid: 101, gid: 10, mode })
  }

  it('runs each line in order', () => {
    script('/home/alice/s', 'echo one\necho two\n')
    expect(t.run('./s').stdout).toBe('one\ntwo\n')
  })

  it('passes arguments as $1, $2, $# and $*', () => {
    script('/home/alice/s', 'echo $2 $1\necho $# args: $*\necho $0\n')
    expect(t.run('./s first second').stdout).toBe('second first\n2 args: first second\n./s\n')
  })

  it('skips comments and blank lines', () => {
    script('/home/alice/s', '# a comment\n\necho ran # trailing\n')
    expect(t.run('./s').stdout).toBe('ran\n')
  })

  it('can be piped and redirected like any command', () => {
    script('/home/alice/s', 'echo from script\n')
    expect(t.run('./s | cat').stdout).toBe('from script\n')
    t.run('./s > out')
    expect(t.run('cat out').stdout).toBe('from script\n')
  })

  it('reads piped input', () => {
    script('/home/alice/s', 'cat\n')
    expect(t.run('echo piped | ./s').stdout).toBe('piped\n')
  })

  it('does not change the caller\'s directory or variables', () => {
    script('/home/alice/s', 'cd /tmp\nX=changed\npwd\n')
    t.run('X=original')
    expect(t.run('./s').stdout).toBe('/tmp\n')
    expect(t.run('pwd; echo $X').stdout).toBe('/home/alice\noriginal\n')
  })

  it('stops at exit and returns its status', () => {
    script('/home/alice/s', 'echo before\nexit 3\necho after\n')
    const result = t.run('./s')
    expect(result.stdout).toBe('before\n')
    expect(result.status).toBe(3)
    expect(t.shell.depth).toBe(1)
  })

  it('returns the status of its last command', () => {
    script('/home/alice/s', 'cat /nope\n')
    expect(t.run('./s').status).toBe(1)
  })

  it('cannot recurse forever', () => {
    script('/home/alice/loop', '/home/alice/loop\n')
    const result = t.run('./loop')
    expect(result.stderr).toContain('too many nested commands')
  })

  it('runs via sh without needing execute permission', () => {
    script('/home/alice/s', 'echo via sh $1\n', 0o644)
    expect(t.run('sh s arg').stdout).toBe('via sh arg\n')
  })

  it('sh -c runs a command string', () => {
    expect(t.run("sh -c 'echo inline; whoami'").stdout).toBe('inline\nalice\n')
  })

  it('sh reads a script from a pipe', () => {
    expect(t.run('echo whoami | sh').stdout).toBe('alice\n')
  })

  it('records commands run inside scripts, with their depth', () => {
    script('/home/alice/s', 'whoami\n')
    const { record } = t.run('./s')
    expect(record.commands).toEqual([
      { argv: ['whoami'], path: '/usr/ucb/whoami', status: 0, euid: 101, depth: 1 },
      { argv: ['./s'], path: '/home/alice/s', status: 0, euid: 101, depth: 0 },
    ])
  })

  it('runs with the permissions of the caller', () => {
    script('/home/alice/s', 'echo x > /etc/owned\n')
    expect(t.run('./s').stderr).toBe('/etc/owned: Permission denied\n')
    expect(t.host.fs.tryStat('/etc/owned', ALICE)).toBeUndefined()
  })
})

describe('setuid', () => {
  const ROOT = { uid: 0, gid: 0, groups: [0] }

  it('a setuid program runs as the file owner, not the caller', () => {
    t.host.fs.install('/usr/local/bin/asroot', { program: 'whoami', mode: 0o4755, uid: 0 })
    expect(t.run('whoami').stdout).toBe('alice\n')
    expect(t.run('asroot').stdout).toBe('root\n')
  })

  it('without the bit, the same program runs as the caller', () => {
    t.host.fs.install('/usr/local/bin/asroot', { program: 'whoami', mode: 0o755, uid: 0 })
    expect(t.run('asroot').stdout).toBe('alice\n')
  })

  it('setuid to an ordinary user works the same way', () => {
    t.host.fs.install('/usr/local/bin/asbob', { program: 'whoami', mode: 0o4755, uid: 102 })
    expect(t.run('asbob').stdout).toBe('bob\n')
  })

  it('a setuid script does things its caller could not', () => {
    t.host.fs.install('/usr/local/bin/helper', {
      content: 'echo $1 > $2\n',
      mode: 0o4755,
      uid: 0,
    })
    expect(t.run('echo x > /etc/owned').stderr).toContain('Permission denied')
    expect(t.run('helper planted /etc/owned').status).toBe(0)
    expect(t.host.fs.readFile('/etc/owned', ROOT)).toBe('planted\n')
    expect(t.host.fs.stat('/etc/owned', ROOT).uid).toBe(0)
  })

  it('removing the bit removes the power', () => {
    t.host.fs.install('/usr/local/bin/helper', {
      content: 'echo $1 > $2\n',
      mode: 0o4755,
      uid: 0,
    })
    t.host.fs.chmod('/usr/local/bin/helper', 0o755, ROOT)
    const result = t.run('helper planted /etc/owned')
    expect(result.stderr).toBe('/etc/owned: Permission denied\n')
    expect(t.host.fs.tryStat('/etc/owned', ROOT)).toBeUndefined()
  })

  it('a setuid copy of the shell gives an interactive shell as its owner', () => {
    t.host.fs.install('/tmp/rootsh', { program: 'sh', mode: 0o4755, uid: 0 })
    expect(t.shell.prompt).toBe('testhost$ ')
    t.run('/tmp/rootsh')
    expect(t.shell.depth).toBe(2)
    expect(t.shell.prompt).toBe('testhost# ')
    expect(t.run('whoami').stdout).toBe('root\n')
    expect(t.run('echo x > /etc/owned').status).toBe(0)
    t.run('exit')
    expect(t.shell.depth).toBe(1)
    expect(t.run('whoami').stdout).toBe('alice\n')
  })

  it('records the effective user for commands run under setuid', () => {
    t.host.fs.install('/tmp/rootsh', { program: 'sh', mode: 0o4755, uid: 0 })
    t.run('/tmp/rootsh')
    expect(t.run('whoami').record).toMatchObject({ euid: 0 })
  })
})

describe('interactive shells', () => {
  it('sh starts a nested shell and exit leaves it', () => {
    t.run('cd /tmp')
    t.run('sh')
    expect(t.shell.depth).toBe(2)
    expect(t.run('pwd').stdout).toBe('/tmp\n')
    t.run('cd /etc')
    t.run('exit')
    expect(t.shell.depth).toBe(1)
    expect(t.run('pwd').stdout).toBe('/tmp\n')
  })

  it('exit at the login shell explains instead of logging out', () => {
    const result = t.run('exit')
    expect(result.stderr).toContain('this is your login shell')
    expect(t.shell.depth).toBe(1)
  })

  it('keeps one history across nested shells', () => {
    t.run('echo one')
    t.run('sh')
    t.run('echo two')
    expect(t.run('history').stdout).toBe(
      '    1  echo one\n    2  sh\n    3  echo two\n    4  history\n',
    )
  })

  it('does not record blank lines in history', () => {
    t.run('')
    t.run('   ')
    expect(t.shell.history).toEqual([])
  })
})

describe('command records', () => {
  it('captures the line, place, user and time', () => {
    t.run('cd /tmp')
    t.clock.advance(60)
    const { record } = t.run('echo hi')
    expect(record).toMatchObject({
      line: 'echo hi',
      prompt: 'testhost$ ',
      host: 'testhost',
      cwd: '/tmp',
      euid: 101,
      time: t.clock.now,
      status: 0,
      clear: false,
      page: false,
    })
  })

  it('captures which files were touched', () => {
    t.run('echo x > notes')
    const { record } = t.run('cat notes')
    expect(record.accesses).toContainEqual({ op: 'read', path: '/home/alice/notes', uid: 101 })
  })

  it('keeps output and errors in the order they appeared', () => {
    const { record } = t.run('echo one; cat /nope; echo two')
    expect(record.output).toEqual([
      { stream: 'out', text: 'one\n' },
      { stream: 'err', text: 'cat: /nope: No such file or directory\n' },
      { stream: 'out', text: 'two\n' },
    ])
  })

  it('clear wipes earlier output and flags the record', () => {
    const { record } = t.run('echo gone; clear; echo kept')
    expect(record.clear).toBe(true)
    expect(record.output).toEqual([{ stream: 'out', text: 'kept\n' }])
  })
})

describe('help', () => {
  it('lists builtins and installed programs with summaries', () => {
    const { stdout } = t.run('help')
    expect(stdout).toMatch(/^cd +change the working directory$/m)
    expect(stdout).toMatch(/^echo +print its arguments$/m)
    expect(stdout).toContain('man ls')
  })
})

describe('saving a session', () => {
  it('restores directory, variables, history and nested shells', async () => {
    const { Shell } = await import('./session.ts')
    const { programs } = await import('./commands/index.ts')
    t.host.fs.install('/tmp/rootsh', { program: 'sh', mode: 0o4755, uid: 0 })
    t.run('cd /tmp')
    t.run('X=kept')
    t.run('/tmp/rootsh')

    const saved = JSON.parse(JSON.stringify(t.shell.serialize()))
    const restored = Shell.restore(saved, t.host, programs)

    expect(restored.depth).toBe(2)
    expect(restored.prompt).toBe('testhost# ')
    expect(restored.cwd).toBe('/tmp')
    expect(restored.history).toEqual(['cd /tmp', 'X=kept', '/tmp/rootsh'])
    expect(restored.run('echo $X').output).toEqual([{ stream: 'out', text: 'kept\n' }])
    restored.run('exit')
    expect(restored.user).toBe('alice')
  })
})

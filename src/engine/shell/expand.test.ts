import { describe, expect, it } from 'vitest'
import { normalize } from '../vfs/index.ts'
import { expandWord, type ExpandContext } from './expand.ts'
import { tokenize } from './lexer.ts'

// A tiny fake filesystem: directory path → names.
const DIRS: Record<string, string[]> = {
  '/': ['etc', 'home', 'tmp'],
  '/etc': ['group', 'passwd'],
  '/home': ['alice', 'bob'],
  '/home/alice': ['.plan', 'a.log', 'b.log', 'notes', 'report[1]', 'work'],
  '/home/alice/work': ['x.log', 'y.txt'],
  '/home/bob': ['b.log'],
  '/tmp': [],
}

const FILES = new Set(
  Object.entries(DIRS).flatMap(([dir, names]) => names.map((n) => normalize(`${dir}/${n}`))),
)

function context(vars: Record<string, string> = {}, cwd = '/home/alice'): ExpandContext {
  return {
    variable: (name) => vars[name],
    cwd,
    listDir: (path) => DIRS[path],
    exists: (path) => path === '/' || FILES.has(path),
    homeOf: (user) => (user === undefined ? '/home/alice' : user === 'bob' ? '/home/bob' : undefined),
  }
}

/** Expand every word of a line, as the shell would to build an argument list. */
function expand(line: string, vars?: Record<string, string>, cwd?: string): string[] {
  const ctx = context(vars, cwd)
  return tokenize(line).flatMap((t) => (t.type === 'word' ? expandWord(t.word, ctx) : []))
}

describe('variables', () => {
  it('expands $NAME and ${NAME}', () => {
    expect(expand('echo $USER ${USER}x', { USER: 'alice' })).toEqual(['echo', 'alice', 'alicex'])
  })

  it('expands positional and special parameters', () => {
    expect(expand('mv $1 $2', { 1: 'from', 2: 'to' })).toEqual(['mv', 'from', 'to'])
    expect(expand('echo $? $#', { '?': '0', '#': '2' })).toEqual(['echo', '0', '2'])
  })

  it('drops an unquoted variable that is unset or empty', () => {
    expect(expand('echo $NOPE end')).toEqual(['echo', 'end'])
    expect(expand('echo a${NOPE}b')).toEqual(['echo', 'ab'])
  })

  it('keeps an empty argument when the variable is double-quoted', () => {
    expect(expand('echo "$NOPE" end')).toEqual(['echo', '', 'end'])
  })

  it('splits an unquoted value into separate arguments', () => {
    expect(expand('rm $FILES', { FILES: 'a b  c' })).toEqual(['rm', 'a', 'b', 'c'])
    expect(expand('echo x$V-y', { V: '1 2' })).toEqual(['echo', 'x1', '2-y'])
    expect(expand('echo x$V-y', { V: ' 1 ' })).toEqual(['echo', 'x', '1', '-y'])
  })

  it('does not split a double-quoted value', () => {
    expect(expand('rm "$FILES"', { FILES: 'a b  c' })).toEqual(['rm', 'a b  c'])
  })

  it('does not expand inside single quotes or after a backslash', () => {
    expect(expand("echo '$USER' \\$USER", { USER: 'alice' })).toEqual(['echo', '$USER', '$USER'])
    expect(expand('echo "cost: \\$5"', { 5: 'five' })).toEqual(['echo', 'cost: $5'])
  })

  it('leaves a lone dollar sign alone', () => {
    expect(expand('echo $ 5$ $%')).toEqual(['echo', '$', '5$', '$%'])
  })
})

describe('tilde', () => {
  it('expands ~ and ~/path to the home directory', () => {
    expect(expand('cd ~')).toEqual(['cd', '/home/alice'])
    expect(expand('cat ~/notes')).toEqual(['cat', '/home/alice/notes'])
  })

  it('expands ~user', () => {
    expect(expand('ls ~bob ~bob/b.log')).toEqual(['ls', '/home/bob', '/home/bob/b.log'])
  })

  it('leaves an unknown ~user, a quoted tilde and a mid-word tilde alone', () => {
    expect(expand("echo ~nobody '~' a~b")).toEqual(['echo', '~nobody', '~', 'a~b'])
  })
})

describe('wildcards', () => {
  it('expands * against the working directory, sorted, skipping hidden files', () => {
    expect(expand('ls *')).toEqual(['ls', 'a.log', 'b.log', 'notes', 'report[1]', 'work'])
  })

  it('matches by suffix and prefix', () => {
    expect(expand('cat *.log')).toEqual(['cat', 'a.log', 'b.log'])
    expect(expand('cat a*')).toEqual(['cat', 'a.log'])
  })

  it('shows hidden files when the pattern starts with a dot', () => {
    expect(expand('ls .*')).toEqual(['ls', '.plan'])
  })

  it('matches one character with ?', () => {
    expect(expand('cat ?.log')).toEqual(['cat', 'a.log', 'b.log'])
    expect(expand('cat ?.lo')).toEqual(['cat', '?.lo'])
  })

  it('matches sets, ranges and negated sets', () => {
    expect(expand('cat [ab].log')).toEqual(['cat', 'a.log', 'b.log'])
    expect(expand('cat [b-z].log')).toEqual(['cat', 'b.log'])
    expect(expand('cat [!a].log')).toEqual(['cat', 'b.log'])
  })

  it('expands in absolute paths and keeps them absolute', () => {
    expect(expand('ls /home/*/b.log')).toEqual(['ls', '/home/alice/b.log', '/home/bob/b.log'])
    expect(expand('ls /e*')).toEqual(['ls', '/etc'])
  })

  it('expands in a subdirectory and keeps the path relative', () => {
    expect(expand('cat work/*.log')).toEqual(['cat', 'work/x.log'])
    expect(expand('cat */*.log', {}, '/home')).toEqual(['cat', 'alice/a.log', 'alice/b.log', 'bob/b.log'])
  })

  it('passes a pattern through unchanged when nothing matches', () => {
    expect(expand('cat *.zip /nowhere/*')).toEqual(['cat', '*.zip', '/nowhere/*'])
  })

  it('does not expand quoted wildcards', () => {
    expect(expand(`grep '*' "*.log" \\*.log`)).toEqual(['grep', '*', '*.log', '*.log'])
  })

  it('treats quoted parts of a pattern literally', () => {
    expect(expand(`ls 'report['*`)).toEqual(['ls', 'report[1]'])
  })

  it('expands wildcards that arrive through an unquoted variable', () => {
    expect(expand('ls $P', { P: '*.log' })).toEqual(['ls', 'a.log', 'b.log'])
    expect(expand('ls "$P"', { P: '*.log' })).toEqual(['ls', '*.log'])
  })

  it('combines tilde and wildcards', () => {
    expect(expand('ls ~bob/*')).toEqual(['ls', '/home/bob/b.log'])
  })

  it('treats an unclosed bracket as a literal', () => {
    expect(expand('echo report[1')).toEqual(['echo', 'report[1'])
  })
})

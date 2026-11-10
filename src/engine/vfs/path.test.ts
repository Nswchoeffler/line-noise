import { describe, expect, it } from 'vitest'
import { basename, dirname, join, normalize, resolve, split } from './path.ts'
import { VfsError } from './types.ts'

describe('split', () => {
  it('breaks an absolute path into components', () => {
    expect(split('/usr/adm/usage.log')).toEqual(['usr', 'adm', 'usage.log'])
  })

  it('returns no components for the root', () => {
    expect(split('/')).toEqual([])
  })

  it('drops empty and "." components', () => {
    expect(split('//usr/./adm/')).toEqual(['usr', 'adm'])
  })

  it('resolves ".." and never climbs above the root', () => {
    expect(split('/usr/adm/../lib')).toEqual(['usr', 'lib'])
    expect(split('/../../etc')).toEqual(['etc'])
  })

  it('rejects relative paths', () => {
    expect(() => split('usr/adm')).toThrow(VfsError)
  })
})

describe('normalize', () => {
  it.each([
    ['/', '/'],
    ['/usr/', '/usr'],
    ['/usr//adm', '/usr/adm'],
    ['/usr/adm/..', '/usr'],
    ['/usr/./adm/.', '/usr/adm'],
    ['/..', '/'],
  ])('%s becomes %s', (input, expected) => {
    expect(normalize(input)).toBe(expected)
  })
})

describe('resolve', () => {
  it('keeps absolute paths, ignoring the working directory', () => {
    expect(resolve('/home/ops', '/etc/passwd')).toBe('/etc/passwd')
  })

  it('resolves relative paths against the working directory', () => {
    expect(resolve('/home/ops', 'notes')).toBe('/home/ops/notes')
    expect(resolve('/home/ops', '../marge')).toBe('/home/marge')
    expect(resolve('/home/ops', '.')).toBe('/home/ops')
    expect(resolve('/', 'etc')).toBe('/etc')
  })

  it('treats an empty path as the working directory', () => {
    expect(resolve('/home/ops', '')).toBe('/home/ops')
  })
})

describe('dirname and basename', () => {
  it.each([
    ['/usr/adm/usage.log', '/usr/adm', 'usage.log'],
    ['/etc', '/', 'etc'],
    ['/', '/', '/'],
    ['/usr/adm/', '/usr', 'adm'],
  ])('%s → %s + %s', (path, dir, base) => {
    expect(dirname(path)).toBe(dir)
    expect(basename(path)).toBe(base)
  })
})

describe('join', () => {
  it('joins parts with single slashes', () => {
    expect(join('/usr', 'adm')).toBe('/usr/adm')
    expect(join('/', 'etc')).toBe('/etc')
    expect(join('/usr/', '/adm')).toBe('/usr/adm')
  })
})

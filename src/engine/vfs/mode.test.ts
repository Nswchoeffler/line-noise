import { describe, expect, it } from 'vitest'
import { applyModeSpec, formatMode, ModeSpecError } from './mode.ts'

describe('formatMode', () => {
  it.each([
    ['file', 0o644, '-rw-r--r--'],
    ['file', 0o755, '-rwxr-xr-x'],
    ['dir', 0o755, 'drwxr-xr-x'],
    ['file', 0o000, '----------'],
    ['file', 0o777, '-rwxrwxrwx'],
    ['file', 0o600, '-rw-------'],
  ] as const)('%s %o → %s', (kind, mode, expected) => {
    expect(formatMode(kind, mode)).toBe(expected)
  })

  it('shows setuid as "s" in the owner execute slot', () => {
    expect(formatMode('file', 0o4755)).toBe('-rwsr-xr-x')
  })

  it('shows setuid without execute as a capital "S"', () => {
    expect(formatMode('file', 0o4644)).toBe('-rwSr--r--')
  })

  it('shows setgid in the group execute slot', () => {
    expect(formatMode('file', 0o2755)).toBe('-rwxr-sr-x')
    expect(formatMode('file', 0o2745)).toBe('-rwxr-Sr-x')
  })

  it('shows the sticky bit in the other execute slot', () => {
    expect(formatMode('dir', 0o1777)).toBe('drwxrwxrwt')
    expect(formatMode('dir', 0o1776)).toBe('drwxrwxrwT')
  })
})

describe('applyModeSpec: octal', () => {
  it('replaces the whole mode', () => {
    expect(applyModeSpec(0o644, '755')).toBe(0o755)
    expect(applyModeSpec(0o4755, '755')).toBe(0o755)
    expect(applyModeSpec(0o755, '4755')).toBe(0o4755)
    expect(applyModeSpec(0o777, '0')).toBe(0)
  })

  it('rejects digits that are not octal', () => {
    expect(() => applyModeSpec(0o644, '888')).toThrow(ModeSpecError)
    expect(() => applyModeSpec(0o644, '77777')).toThrow(ModeSpecError)
  })
})

describe('applyModeSpec: symbolic', () => {
  it('removes the setuid bit with u-s and leaves the rest alone', () => {
    expect(applyModeSpec(0o4755, 'u-s')).toBe(0o755)
  })

  it('adds the setuid bit with u+s', () => {
    expect(applyModeSpec(0o755, 'u+s')).toBe(0o4755)
  })

  it('adds setgid with g+s, and both with a bare +s', () => {
    expect(applyModeSpec(0o755, 'g+s')).toBe(0o2755)
    expect(applyModeSpec(0o755, '+s')).toBe(0o6755)
  })

  it('does not set setuid when "s" is given to "other" only', () => {
    expect(applyModeSpec(0o755, 'o+s')).toBe(0o755)
  })

  it('treats a missing "who" as everyone', () => {
    expect(applyModeSpec(0o644, '+x')).toBe(0o755)
    expect(applyModeSpec(0o755, '-x')).toBe(0o644)
    expect(applyModeSpec(0o644, 'a+x')).toBe(0o755)
  })

  it('changes only the named classes', () => {
    expect(applyModeSpec(0o644, 'u+x')).toBe(0o744)
    expect(applyModeSpec(0o666, 'go-w')).toBe(0o644)
    expect(applyModeSpec(0o600, 'g+r')).toBe(0o640)
    expect(applyModeSpec(0o777, 'o-rwx')).toBe(0o770)
  })

  it('replaces a class with "="', () => {
    expect(applyModeSpec(0o777, 'go=r')).toBe(0o744)
    expect(applyModeSpec(0o4755, 'u=rw')).toBe(0o655)
    expect(applyModeSpec(0o755, 'o=')).toBe(0o750)
  })

  it('applies comma-separated clauses in order', () => {
    expect(applyModeSpec(0o000, 'u=rwx,go=rx')).toBe(0o755)
    expect(applyModeSpec(0o777, 'u-x,g-w,o-rwx')).toBe(0o650)
  })

  it('sets and clears the sticky bit', () => {
    expect(applyModeSpec(0o777, '+t')).toBe(0o1777)
    expect(applyModeSpec(0o1777, '-t')).toBe(0o777)
  })

  it.each(['', 'x', 'u+q', 'z+x', 'u+x,', 'rwx', '+x+w'])('rejects %j', (spec) => {
    expect(() => applyModeSpec(0o644, spec)).toThrow(ModeSpecError)
  })
})

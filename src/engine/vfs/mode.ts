import { S_ISGID, S_ISUID, S_ISVTX, type NodeKind } from './types.ts'

function triplet(bits: number, special: boolean, specialChar: string): string {
  const r = bits & 4 ? 'r' : '-'
  const w = bits & 2 ? 'w' : '-'
  const canExec = (bits & 1) !== 0
  let x: string
  if (special) x = canExec ? specialChar : specialChar.toUpperCase()
  else x = canExec ? 'x' : '-'
  return r + w + x
}

/** The ten-character mode string that `ls -l` prints, such as `-rwsr-xr-x`. */
export function formatMode(kind: NodeKind, mode: number): string {
  return (
    (kind === 'dir' ? 'd' : '-') +
    triplet((mode >> 6) & 7, (mode & S_ISUID) !== 0, 's') +
    triplet((mode >> 3) & 7, (mode & S_ISGID) !== 0, 's') +
    triplet(mode & 7, (mode & S_ISVTX) !== 0, 't')
  )
}

export class ModeSpecError extends Error {
  constructor(spec: string) {
    super(`invalid mode: ${spec}`)
    this.name = 'ModeSpecError'
  }
}

const CLAUSE = /^([ugoa]*)([+\-=])([rwxst]*)$/

/**
 * Apply a `chmod` mode argument to an existing mode.
 * Accepts octal (`755`, `4755`) and symbolic (`u-s`, `+x`, `go-w`, `u=rw,go=r`).
 */
export function applyModeSpec(current: number, spec: string): number {
  if (/^[0-7]{1,4}$/.test(spec)) return parseInt(spec, 8)
  if (spec === '') throw new ModeSpecError(spec)

  let mode = current
  for (const clause of spec.split(',')) {
    const match = CLAUSE.exec(clause)
    if (!match) throw new ModeSpecError(spec)
    const who = match[1] === '' || match[1]!.includes('a') ? 'ugo' : match[1]!
    const op = match[2]!
    const perms = match[3]!

    let bits = 0
    for (const w of who) {
      const shift = w === 'u' ? 6 : w === 'g' ? 3 : 0
      if (perms.includes('r')) bits |= 4 << shift
      if (perms.includes('w')) bits |= 2 << shift
      if (perms.includes('x')) bits |= 1 << shift
      if (perms.includes('s') && w === 'u') bits |= S_ISUID
      if (perms.includes('s') && w === 'g') bits |= S_ISGID
    }
    if (perms.includes('t')) bits |= S_ISVTX

    if (op === '+') mode |= bits
    else if (op === '-') mode &= ~bits
    else {
      // "=" replaces the permissions of every class named in the clause.
      let clear = 0
      for (const w of who) {
        if (w === 'u') clear |= 0o700 | S_ISUID
        else if (w === 'g') clear |= 0o070 | S_ISGID
        else clear |= 0o007
      }
      mode = (mode & ~clear) | bits
    }
  }
  return mode & 0o7777
}

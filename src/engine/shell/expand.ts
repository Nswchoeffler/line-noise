import { resolve } from '../vfs/index.ts'
import type { Word } from './lexer.ts'

/** What word expansion needs to know about the shell and the filesystem. */
export interface ExpandContext {
  /** Value of a variable or special parameter (`HOME`, `1`, `?`, `#`, `*`), if set. */
  variable: (name: string) => string | undefined
  cwd: string
  /** Names in a directory, or undefined if it cannot be listed. */
  listDir: (absPath: string) => string[] | undefined
  exists: (absPath: string) => boolean
  /** Home directory of a user, or of the current user when no name is given. */
  homeOf: (user: string | undefined) => string | undefined
}

/** A run of text inside a field. `active` text is open to wildcard matching. */
interface Segment {
  text: string
  active: boolean
}

interface Field {
  segments: Segment[]
  /** A quoted part keeps a field alive even when it is empty, so `''` is an argument. */
  quoted: boolean
}

const VARIABLE = /\$(?:\{([A-Za-z_][A-Za-z0-9_]*|[0-9?#*@$])\}|([A-Za-z_][A-Za-z0-9_]*|[0-9?#*@$]))/g

/** Replace `$name` and `${name}` with values. Unset variables become nothing. */
function substitute(text: string, ctx: ExpandContext): string {
  return text.replace(VARIABLE, (_, braced: string | undefined, bare: string | undefined) => {
    return ctx.variable((braced ?? bare)!) ?? ''
  })
}

const GLOB_CHARS = /[*?[]/

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface PatternChar {
  ch: string
  active: boolean
}

/** Turn one path component of a wildcard pattern into a regular expression. */
function componentToRegExp(chars: PatternChar[]): RegExp {
  let source = '^'
  for (let i = 0; i < chars.length; i++) {
    const { ch, active } = chars[i]!
    if (!active) {
      source += escapeRegExp(ch)
    } else if (ch === '*') {
      source += '[^/]*'
    } else if (ch === '?') {
      source += '[^/]'
    } else if (ch === '[') {
      // A bracket set runs to the next "]" that is not the first character.
      let end = -1
      for (let j = i + 2; j < chars.length; j++) {
        if (chars[j]!.ch === ']' && chars[j]!.active) {
          end = j
          break
        }
      }
      if (end === -1) {
        source += '\\['
        continue
      }
      let body = chars
        .slice(i + 1, end)
        .map((c) => c.ch)
        .join('')
      let negate = false
      if (body.startsWith('!') || body.startsWith('^')) {
        negate = true
        body = body.slice(1)
      }
      source += `[${negate ? '^' : ''}${body.replace(/[\\\]^]/g, '\\$&')}]`
      i = end
    } else {
      source += escapeRegExp(ch)
    }
  }
  return new RegExp(source + '$')
}

/** Match a field containing wildcards against the filesystem. Empty when nothing matches. */
function glob(field: Field, ctx: ExpandContext): string[] {
  const chars: PatternChar[] = []
  for (const segment of field.segments) {
    for (const ch of segment.text) chars.push({ ch, active: segment.active })
  }

  // Split into path components at every slash, quoted or not.
  const components: PatternChar[][] = [[]]
  for (const c of chars) {
    if (c.ch === '/') components.push([])
    else components[components.length - 1]!.push(c)
  }

  const absolute = chars[0]?.ch === '/'
  let candidates = [{ display: absolute ? '/' : '', abs: absolute ? '/' : ctx.cwd }]
  const append = (display: string, name: string): string =>
    display === '' ? name : display.endsWith('/') ? display + name : `${display}/${name}`

  for (const component of components) {
    if (component.length === 0) continue
    const literal = component.map((c) => c.ch).join('')
    const isPattern = component.some((c) => c.active && GLOB_CHARS.test(c.ch))

    if (!isPattern) {
      candidates = candidates.map((c) => ({
        display: append(c.display, literal),
        abs: resolve(c.abs, literal),
      }))
      continue
    }

    const pattern = componentToRegExp(component)
    // Names starting with a dot are hidden unless the pattern names the dot.
    const showHidden = component[0]!.ch === '.'
    const matched: typeof candidates = []
    for (const c of candidates) {
      for (const name of ctx.listDir(c.abs) ?? []) {
        if (name.startsWith('.') && !showHidden) continue
        if (pattern.test(name)) {
          matched.push({ display: append(c.display, name), abs: resolve(c.abs, name) })
        }
      }
    }
    candidates = matched
  }

  return candidates
    .filter((c) => ctx.exists(c.abs))
    .map((c) => c.display)
    .sort()
}

/**
 * Expand one parsed word into the arguments it stands for: usually one, but
 * a wildcard can produce many and an empty unquoted variable produces none.
 *
 * Order, as in the Bourne shell: tilde, variables, word splitting, wildcards.
 */
export function expandWord(word: Word, ctx: ExpandContext): string[] {
  const fields: Field[] = []
  let current: Field = { segments: [], quoted: false }

  const endField = (): void => {
    if (current.segments.length > 0 || current.quoted) fields.push(current)
    current = { segments: [], quoted: false }
  }

  word.forEach((part, index) => {
    if (part.quote === 'single') {
      current.segments.push({ text: part.text, active: false })
      current.quoted = true
      return
    }
    if (part.quote === 'double') {
      current.segments.push({ text: substitute(part.text, ctx), active: false })
      current.quoted = true
      return
    }

    let text = part.text

    // Tilde: only at the very start of a word, and only up to the first slash.
    if (index === 0 && text.startsWith('~')) {
      const slash = text.indexOf('/')
      const user = text.slice(1, slash === -1 ? undefined : slash)
      const home = ctx.homeOf(user === '' ? undefined : user)
      if (home !== undefined) {
        current.segments.push({ text: home, active: false })
        text = slash === -1 ? '' : text.slice(slash)
      }
    }

    // Literal text stays in the field; variable values are split on whitespace.
    let last = 0
    for (const match of text.matchAll(VARIABLE)) {
      if (match.index > last) {
        current.segments.push({ text: text.slice(last, match.index), active: true })
      }
      last = match.index + match[0].length

      const value = ctx.variable((match[1] ?? match[2])!) ?? ''
      if (value === '') continue
      if (/^\s/.test(value)) endField()
      const pieces = value.split(/\s+/).filter((p) => p !== '')
      pieces.forEach((piece, i) => {
        if (i > 0) endField()
        current.segments.push({ text: piece, active: true })
      })
      if (/\s$/.test(value)) endField()
    }
    if (last < text.length) current.segments.push({ text: text.slice(last), active: true })
  })
  endField()

  const out: string[] = []
  for (const field of fields) {
    const literal = field.segments.map((s) => s.text).join('')
    const hasWildcard = field.segments.some((s) => s.active && GLOB_CHARS.test(s.text))
    const matches = hasWildcard ? glob(field, ctx) : []
    // A pattern that matches nothing is passed through unchanged.
    if (matches.length > 0) out.push(...matches)
    else out.push(literal)
  }
  return out
}

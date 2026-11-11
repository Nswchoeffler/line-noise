import type { Blank, LogbookEntry } from './schema.ts'

/** What the player put in a logbook entry. */
export type Answer =
  | { kind: 'fill'; values: Record<string, string> }
  | { kind: 'choose'; chosen: string[] }
  | { kind: 'pin'; text: string; source: string }
  | { kind: 'write'; text: string }

export interface Grade {
  correct: boolean
  /** For fill entries: which blanks are right. */
  blanks?: Record<string, boolean>
  /** Where to look next, when the answer is not right yet. */
  hint?: string
}

export type EntryKind = Answer['kind']

export function entryKind(entry: LogbookEntry): EntryKind {
  if ('fill' in entry) return 'fill'
  if ('choose' in entry) return 'choose'
  if ('pin' in entry) return 'pin'
  return 'write'
}

/** Lower case, trimmed, single spaces: so "  PIKE " equals "pike". */
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

function blankCorrect(blank: Blank, value: string): boolean {
  const given = normalize(value)
  if (given === '') return false
  if (blank.accept) return blank.accept.some((a) => normalize(a) === given)
  if (blank.matches !== undefined) return new RegExp(blank.matches, 'i').test(given)
  if (blank.number) {
    // Take the first number in the answer, so "37 minutes" and "2,220" both work.
    const match = /-?\d+(?:\.\d+)?/.exec(given.replace(/(\d),(?=\d)/g, '$1'))
    if (!match) return false
    return Math.abs(Number(match[0]) - blank.number.value) <= blank.number.tolerance
  }
  return false
}

/** Mark an answer. Wrong answers cost nothing; the player just tries again. */
export function grade(entry: LogbookEntry, answer: Answer): Grade {
  if ('fill' in entry) {
    if (answer.kind !== 'fill') return { correct: false }
    const blanks: Record<string, boolean> = {}
    let hint: string | undefined
    for (const [name, blank] of Object.entries(entry.blanks)) {
      const value = answer.values[name] ?? ''
      blanks[name] = blankCorrect(blank, value)
      // Offer the hint for the first blank that was attempted and is wrong.
      if (!blanks[name] && hint === undefined && value.trim() !== '') hint = blank.hint
    }
    const correct = Object.values(blanks).every(Boolean)
    return { correct, blanks, ...(hint === undefined ? {} : { hint }) }
  }

  let correct: boolean
  if ('choose' in entry) {
    if (answer.kind !== 'choose') return { correct: false }
    const chosen = new Set(answer.chosen)
    correct = chosen.size === entry.correct.length && entry.correct.every((id) => chosen.has(id))
  } else if ('pin' in entry) {
    if (answer.kind !== 'pin') return { correct: false }
    correct = new RegExp(entry.pin.matches, 'i').test(answer.text)
  } else {
    if (answer.kind !== 'write') return { correct: false }
    const text = normalize(answer.text)
    correct =
      text.split(' ').length >= 3 &&
      entry.write.mentions.every((idea) => idea.some((word) => text.includes(normalize(word))))
  }
  return { correct, ...(!correct && entry.hint !== undefined ? { hint: entry.hint } : {}) }
}

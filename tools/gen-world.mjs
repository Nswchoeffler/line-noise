// Generates the August 1986 records for the host "granite":
//
//   src/content/world/files/usage.log      system accounting, one line per session
//   src/content/world/files/wtmp           login records (what `last` reads)
//   src/content/world/files/ledger         the front office's billing ledger:
//                                          account, minutes, charge, department
//   src/content/world/files/reconcile.aug  the month-end report that does not balance
//
// All four come from one list of sessions, so they always agree with each
// other except in the ways the story needs. The output is deterministic:
// running this again produces the same files. Run it after changing names:
//
//   node tools/gen-world.mjs

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'content', 'world', 'files')

// ---- a small seeded random number generator ---------------------------------

let seed = 1986
function random() {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const between = (low, high) => low + Math.floor(random() * (high - low + 1))

// ---- time helpers (host-local wall time, as the engine uses) -----------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const at = (month, day, hour, minute) => Date.UTC(1986, month - 1, day, hour, minute) / 1000
const two = (n) => String(n).padStart(2, '0')
const dateOf = (t) => {
  const d = new Date(t * 1000)
  return `${MONTHS[d.getUTCMonth()]} ${two(d.getUTCDate())}`
}
const clockOf = (t) => {
  const d = new Date(t * 1000)
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`
}

// ---- the people ---------------------------------------------------------------

const RATE_CENTS = 5 // per connect minute

/** Accounts with paperwork, in the order the front office approved them. */
const ACCOUNTS = [
  { user: 'marge', department: 'Computing Services' },
  { user: 'hollis', department: 'Theory Division' },
  { user: 'lfaber', department: 'Front Office' },
  { user: 'jquill', department: 'Accelerator Operations' },
  { user: 'tnakata', department: 'Detector Group' },
  { user: 'rvoss', department: 'Cryogenics Lab' },
  { user: 'dmbeki', department: 'Theory Division' },
  { user: 'osato', department: 'Optics Lab' },
  { user: 'ops', department: 'Computing Services' },
]

/** Who sits at which terminal, and how often they come in. */
const STAFF = [
  { user: 'tnakata', tty: 'ttyh1', comes: 0.8, twice: 0.4 },
  { user: 'rvoss', tty: 'ttyh2', comes: 0.6, twice: 0.3 },
  { user: 'dmbeki', tty: 'ttyh3', comes: 0.7, twice: 0.5 },
  { user: 'jquill', tty: 'ttyh5', comes: 0.65, twice: 0.3 },
  { user: 'lfaber', tty: 'ttyh6', comes: 0.9, twice: 0.2 },
  { user: 'osato', tty: 'ttyh7', comes: 0.5, twice: 0.3 },
]

// ---- sessions -------------------------------------------------------------------

/** @type {{user: string, tty: string, from: string, start: number, seconds: number}[]} */
const sessions = []
const add = (user, tty, from, start, minutes) =>
  sessions.push({ user, tty, from, start, seconds: minutes * 60 })

// Working days in August 1986: the 1st is a Friday.
const workdays = []
for (let day = 1; day <= 31; day++) {
  const weekday = new Date(Date.UTC(1986, 7, day)).getUTCDay()
  if (weekday >= 1 && weekday <= 5) workdays.push(day)
}

for (const day of workdays) {
  // Marge is in every day, morning and afternoon.
  add('marge', 'ttyh0', '', at(8, day, 7, between(45, 59)), between(180, 235))
  add('marge', 'ttyh0', '', at(8, day, 13, between(0, 25)), between(170, 250))

  for (const person of STAFF) {
    if (random() > person.comes) continue
    add(person.user, person.tty, '', at(8, day, between(8, 9), between(0, 59)), between(25, 170))
    if (random() < person.twice) {
      add(person.user, person.tty, '', at(8, day, between(13, 15), between(0, 29)), between(20, 150))
    }
  }

  // The player started on Monday the 25th.
  if (day >= 25) {
    add('ops', 'ttyh4', '', at(8, day, 8, between(30, 50)), between(150, 200))
    add('ops', 'ttyh4', '', at(8, day, 13, between(5, 30)), between(160, 220))
  }
}

// A few evenings and weekends over the dial-up modem.
add('jquill', 'ttyd0', '', at(8, 9, 21, 10), 35)
add('rvoss', 'ttyd0', '', at(8, 17, 15, 20), 40)
add('jquill', 'ttyd0', '', at(8, 23, 20, 40), 50)

// The account nobody opened: three short sessions through the network gateway,
// 7 + 9 + 7 = 23 minutes, which at 5 cents a minute is the missing $1.15.
add('pike', 'ttyn1', 'shale', at(8, 24, 3, 5), 7)
add('pike', 'ttyn1', 'shale', at(8, 27, 2, 40), 9)
add('pike', 'ttyn1', 'shale', at(8, 30, 1, 15), 7)

// The dormant account. These logins are in the login records, but their
// accounting lines were removed from usage.log (see below).
const SCRUBBED = [
  { user: 'hollis', tty: 'ttyn1', from: 'shale', start: at(8, 21, 2, 14), seconds: 7 * 60 },
  { user: 'hollis', tty: 'ttyn1', from: 'shale', start: at(8, 22, 1, 50), seconds: 50 * 60 },
  { user: 'hollis', tty: 'ttyn1', from: 'shale', start: at(9, 1, 2, 47), seconds: 18 * 60 },
]

// Tuesday 2 September, before the game starts: three people already at work.
const OPEN = [
  { user: 'marge', tty: 'ttyh0', from: '', start: at(9, 2, 8, 5) },
  { user: 'lfaber', tty: 'ttyh6', from: '', start: at(9, 2, 8, 12) },
  { user: 'tnakata', tty: 'ttyh1', from: '', start: at(9, 2, 8, 20) },
]

// ---- usage.log: one line as each session ends ----------------------------------

const byEnd = [...sessions].sort((a, b) => a.start + a.seconds - (b.start + b.seconds))
const usageLog = byEnd
  .map((s) => [s.user, s.tty, dateOf(s.start), clockOf(s.start), s.seconds].join('\t') + '\n')
  .join('')

// ---- wtmp: every login, including the ones scrubbed from usage.log --------------

const logins = [
  ...sessions.map((s) => ({ ...s, end: s.start + s.seconds })),
  ...SCRUBBED.map((s) => ({ ...s, end: s.start + s.seconds })),
  ...OPEN.map((s) => ({ ...s, end: '' })),
].sort((a, b) => a.start - b.start)
const wtmp = logins.map((l) => `${l.user}:${l.tty}:${l.from}:${l.start}:${l.end}\n`).join('')

// ---- the ledger: only accounts with paperwork ----------------------------------

const minutesFor = (user) =>
  sessions.filter((s) => s.user === user).reduce((sum, s) => sum + s.seconds / 60, 0)
const dollars = (minutes) => ((minutes * RATE_CENTS) / 100).toFixed(2)

// Tab-separated like the usage log, so the same tools work on both. The numbers
// are padded to line up, and the department comes last because its length
// varies: put anywhere else it would push the columns after it out of line.
const ledger = ACCOUNTS.map((a) => {
  const minutes = minutesFor(a.user)
  return [a.user, String(minutes).padStart(5), dollars(minutes).padStart(7), a.department].join('\t') + '\n'
}).join('')

// ---- the month-end report ------------------------------------------------------

const usedMinutes = sessions.reduce((sum, s) => sum + s.seconds / 60, 0)
const billedMinutes = ACCOUNTS.reduce((sum, a) => sum + minutesFor(a.user), 0)
const gap = usedMinutes - billedMinutes
const row = (label, minutes) =>
  `${label.padEnd(34)}${String(minutes).padStart(8)}${('$' + dollars(minutes)).padStart(12)}\n`

const reconcile =
  'MONTH-END RECONCILIATION, AUGUST 1986\n' +
  'Calder Ridge Laboratory, Computing Services\n' +
  'Run Tue Sep  2 07:02 1986\n' +
  '\n' +
  `${''.padEnd(34)}${'minutes'.padStart(8)}${'charge'.padStart(12)}\n` +
  row('System accounting (usage.log)', usedMinutes) +
  row('Billing ledger', billedMinutes) +
  `${''.padEnd(34)}${'-------'.padStart(8)}${'--------'.padStart(12)}\n` +
  row('Difference', gap) +
  '\n' +
  '*** THE BOOKS DO NOT BALANCE ***\n' +
  '\n' +
  'Every minute in the system accounting should be billed to an account\n' +
  'in the ledger. Rate: 5 cents per connect minute.\n'

// ---- write ---------------------------------------------------------------------

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'usage.log'), usageLog)
writeFileSync(join(OUT, 'wtmp'), wtmp)
writeFileSync(join(OUT, 'ledger'), ledger)
writeFileSync(join(OUT, 'reconcile.aug'), reconcile)

console.log(`usage.log: ${byEnd.length} lines`)
console.log(`wtmp: ${logins.length} records`)
console.log(`used ${usedMinutes} min, billed ${billedMinutes} min, gap ${gap} min = $${dollars(gap)}`)
console.log(`last usage line ends ${dateOf(byEnd.at(-1).start)} ${clockOf(byEnd.at(-1).start + byEnd.at(-1).seconds)}`)
for (const a of ACCOUNTS) console.log(`  ${a.user.padEnd(8)} ${String(minutesFor(a.user)).padStart(6)} min`)

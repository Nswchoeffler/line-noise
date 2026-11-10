// Times are whole seconds of host-local wall-clock time. Hosts have no notion
// of time zones beyond a label, so all arithmetic here is done in UTC and the
// label is appended for show.

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const two = (n: number): string => String(n).padStart(2, '0')

interface Parts {
  day: string
  month: string
  date: number
  year: number
  hours: number
  minutes: number
  seconds: number
}

function parts(time: number): Parts {
  const d = new Date(time * 1000)
  return {
    day: DAYS[d.getUTCDay()]!,
    month: MONTHS[d.getUTCMonth()]!,
    date: d.getUTCDate(),
    year: d.getUTCFullYear(),
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
    seconds: d.getUTCSeconds(),
  }
}

/** Parse `1986-09-09 08:15` or `1986-09-09 08:15:30` (a `T` separator also works). */
export function parseTime(text: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text.trim())
  if (!match) throw new Error(`not a time: "${text}" (expected YYYY-MM-DD HH:MM)`)
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = match
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
  return ms / 1000
}

/** `Tue Sep  9 08:15:02 PDT 1986`, as `date` prints it. */
export function formatDate(time: number, timezone: string): string {
  const p = parts(time)
  const date = String(p.date).padStart(2, ' ')
  const clock = `${two(p.hours)}:${two(p.minutes)}:${two(p.seconds)}`
  return `${p.day} ${p.month} ${date} ${clock} ${timezone} ${p.year}`
}

const SIX_MONTHS = 182 * 24 * 60 * 60

/**
 * The time column of `ls -l`: `Sep  9 08:15` for recent files, and
 * `Sep  9  1985` for anything older than six months or dated in the future.
 */
export function formatListTime(time: number, now: number): string {
  const p = parts(time)
  const date = `${p.month} ${String(p.date).padStart(2, ' ')}`
  if (time > now || now - time > SIX_MONTHS) return `${date}  ${p.year}`
  return `${date} ${two(p.hours)}:${two(p.minutes)}`
}

/** `Tue Sep  9 08:15`, as `last` and `finger` print a login time. */
export function formatLoginTime(time: number): string {
  const p = parts(time)
  return `${p.day} ${p.month} ${String(p.date).padStart(2, ' ')} ${two(p.hours)}:${two(p.minutes)}`
}

/** `Sep  9 08:15`, as `who` prints it. */
export function formatShortTime(time: number): string {
  const p = parts(time)
  return `${p.month} ${String(p.date).padStart(2, ' ')} ${two(p.hours)}:${two(p.minutes)}`
}

/** `08:15`. */
export function formatClock(time: number): string {
  const p = parts(time)
  return `${two(p.hours)}:${two(p.minutes)}`
}

/** A session length as `last` prints it: `00:37`, or `1+02:05` once it passes a day. */
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const days = Math.floor(minutes / (24 * 60))
  const rest = `${two(Math.floor(minutes / 60) % 24)}:${two(minutes % 60)}`
  return days > 0 ? `${days}+${rest}` : rest
}

export function yearOf(time: number): number {
  return parts(time).year
}

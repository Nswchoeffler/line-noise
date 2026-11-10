/**
 * Login records. The real file (/usr/adm/wtmp) was binary; here it is one
 * text line per login so that it is an ordinary file in the simulated
 * filesystem: permissions apply to it and anyone with root can doctor it.
 *
 *   user:tty:from:login-time:logout-time
 *
 * `from` is empty for a terminal wired to the machine. `logout-time` is empty
 * while the session is still open.
 */
export interface LoginRecord {
  user: string
  tty: string
  /** Where the connection came from. Empty for a local terminal. */
  from: string
  login: number
  /** Undefined while the user is still logged in. */
  logout?: number
}

export const LOGIN_RECORDS_PATH = '/usr/adm/wtmp'

/** Parse the records file. Malformed lines are skipped. */
export function parseLogins(text: string): LoginRecord[] {
  const records: LoginRecord[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    const f = line.split(':')
    if (f.length < 5) continue
    const login = Number(f[3])
    if (f[0] === '' || f[3] === '' || !Number.isFinite(login)) continue
    const record: LoginRecord = { user: f[0]!, tty: f[1]!, from: f[2]!, login }
    if (f[4] !== '') {
      const logout = Number(f[4])
      if (!Number.isFinite(logout)) continue
      record.logout = logout
    }
    records.push(record)
  }
  return records
}

export function formatLogins(records: readonly LoginRecord[]): string {
  return records
    .map((r) => `${r.user}:${r.tty}:${r.from}:${r.login}:${r.logout ?? ''}\n`)
    .join('')
}

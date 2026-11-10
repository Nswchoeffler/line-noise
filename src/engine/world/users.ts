import type { Credentials } from '../vfs/index.ts'

/** One line of /etc/passwd. */
export interface User {
  name: string
  /** The password field. In 1986 the hash sat here, readable by everyone. */
  password: string
  uid: number
  gid: number
  /** Full name and office details (the "GECOS" field). */
  gecos: string
  home: string
  shell: string
}

/** One line of /etc/group. */
export interface Group {
  name: string
  gid: number
  members: string[]
}

/** Parse /etc/passwd text. Malformed lines are skipped, as real tools did. */
export function parsePasswd(text: string): User[] {
  const users: User[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.startsWith('#')) continue
    const f = line.split(':')
    if (f.length < 7) continue
    const uid = Number(f[2])
    const gid = Number(f[3])
    if (f[0] === '' || !Number.isInteger(uid) || !Number.isInteger(gid)) continue
    users.push({
      name: f[0]!,
      password: f[1]!,
      uid,
      gid,
      gecos: f[4]!,
      home: f[5]!,
      shell: f[6]!,
    })
  }
  return users
}

export function formatPasswd(users: readonly User[]): string {
  return users
    .map((u) => [u.name, u.password, u.uid, u.gid, u.gecos, u.home, u.shell].join(':') + '\n')
    .join('')
}

/** Parse /etc/group text. Malformed lines are skipped. */
export function parseGroup(text: string): Group[] {
  const groups: Group[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.startsWith('#')) continue
    const f = line.split(':')
    if (f.length < 4) continue
    const gid = Number(f[2])
    if (f[0] === '' || !Number.isInteger(gid)) continue
    groups.push({
      name: f[0]!,
      gid,
      members: f[3]!.split(',').filter((m) => m !== ''),
    })
  }
  return groups
}

export function formatGroup(groups: readonly Group[]): string {
  return groups.map((g) => `${g.name}:*:${g.gid}:${g.members.join(',')}\n`).join('')
}

/**
 * The accounts on one host, as read from its /etc/passwd and /etc/group.
 * Those two files are the single source of truth: change them and this changes.
 */
export class UserDb {
  readonly users: readonly User[]
  readonly groups: readonly Group[]

  constructor(passwdText: string, groupText: string) {
    this.users = parsePasswd(passwdText)
    this.groups = parseGroup(groupText)
  }

  byName(name: string): User | undefined {
    return this.users.find((u) => u.name === name)
  }

  byUid(uid: number): User | undefined {
    return this.users.find((u) => u.uid === uid)
  }

  groupByName(name: string): Group | undefined {
    return this.groups.find((g) => g.name === name)
  }

  groupByGid(gid: number): Group | undefined {
    return this.groups.find((g) => g.gid === gid)
  }

  /** Name for a uid, or the number itself when no account has it (as `ls -l` shows). */
  userName(uid: number): string {
    return this.byUid(uid)?.name ?? String(uid)
  }

  groupName(gid: number): string {
    return this.groupByGid(gid)?.name ?? String(gid)
  }

  /** The credentials a login as this user would get. */
  credentialsFor(name: string): Credentials | undefined {
    const user = this.byName(name)
    if (!user) return undefined
    const groups = new Set<number>([user.gid])
    for (const group of this.groups) {
      if (group.members.includes(name)) groups.add(group.gid)
    }
    return { uid: user.uid, gid: user.gid, groups: [...groups] }
  }
}

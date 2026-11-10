import { Vfs, type SerializedNode } from '../vfs/index.ts'
import type { Clock } from './clock.ts'
import { UserDb } from './users.ts'

/** One line of `ps` output. The process table is world data, not a simulation. */
export interface ProcessInfo {
  pid: number
  uid: number
  /** Terminal name without the "tty" prefix (`p2`, `h3`), or null for a daemon. */
  tty: string | null
  /** State letters as `ps` shows them: `S` sleeping, `R` running, `I` idle. */
  stat: string
  /** CPU time used, as `m:ss`. */
  time: string
  command: string
}

export interface HostOptions {
  name: string
  clock: Clock
  /** Label only, such as `PDT`. All times are host-local. */
  timezone?: string
  fs?: Vfs
  processes?: ProcessInfo[]
}

/** Plain-data form of a host, for saves. */
export interface SerializedHost {
  name: string
  timezone: string
  fs: SerializedNode
  processes: ProcessInfo[]
}

/** A simulated computer: a filesystem, a clock, accounts and a process table. */
export class Host {
  readonly name: string
  readonly clock: Clock
  readonly fs: Vfs
  timezone: string
  processes: ProcessInfo[]

  private cachedUsers: { passwd: string; group: string; db: UserDb } | undefined

  constructor(options: HostOptions) {
    this.name = options.name
    this.clock = options.clock
    this.timezone = options.timezone ?? 'UTC'
    this.fs = options.fs ?? new Vfs({ now: () => options.clock.now })
    this.processes = options.processes ?? []
  }

  /**
   * The accounts on this host, read from /etc/passwd and /etc/group each time
   * those files change. Edit the files and the accounts change with them.
   */
  get users(): UserDb {
    const passwd = this.fs.peek('/etc/passwd') ?? ''
    const group = this.fs.peek('/etc/group') ?? ''
    const cached = this.cachedUsers
    if (cached && cached.passwd === passwd && cached.group === group) return cached.db
    const db = new UserDb(passwd, group)
    this.cachedUsers = { passwd, group, db }
    return db
  }

  serialize(): SerializedHost {
    return {
      name: this.name,
      timezone: this.timezone,
      fs: this.fs.snapshot(),
      processes: this.processes.map((p) => ({ ...p })),
    }
  }

  static deserialize(data: SerializedHost, clock: Clock): Host {
    return new Host({
      name: data.name,
      clock,
      timezone: data.timezone,
      fs: Vfs.fromSnapshot(data.fs, { now: () => clock.now }),
      processes: data.processes.map((p) => ({ ...p })),
    })
  }

  /** An independent copy under a new name, sharing only the clock. */
  clone(name: string): Host {
    return Host.deserialize({ ...this.serialize(), name }, this.clock)
  }
}

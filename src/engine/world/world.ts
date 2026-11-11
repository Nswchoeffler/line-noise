import { Clock } from './clock.ts'
import { Host, type SerializedHost } from './host.ts'

/** Plain-data form of a world, for saves. */
export interface SerializedWorld {
  now: number
  hosts: SerializedHost[]
}

/** Every host in play, on one shared clock. */
export class World {
  readonly clock: Clock
  private readonly hostsByName = new Map<string, Host>()

  constructor(start: number) {
    this.clock = new Clock(start)
  }

  add(host: Host): Host {
    if (host.clock !== this.clock) throw new Error(`host ${host.name} runs on a different clock`)
    this.hostsByName.set(host.name, host)
    return host
  }

  has(name: string): boolean {
    return this.hostsByName.has(name)
  }

  host(name: string): Host {
    const host = this.hostsByName.get(name)
    if (!host) throw new Error(`no such host: ${name}`)
    return host
  }

  get hosts(): Host[] {
    return [...this.hostsByName.values()]
  }

  remove(name: string): void {
    this.hostsByName.delete(name)
  }

  serialize(): SerializedWorld {
    return { now: this.clock.now, hosts: this.hosts.map((h) => h.serialize()) }
  }

  static deserialize(data: SerializedWorld): World {
    const world = new World(data.now)
    for (const host of data.hosts) world.add(Host.deserialize(host, world.clock))
    return world
  }
}

import { installPrograms } from '../shell/install.ts'
import type { ProgramRegistry } from '../shell/types.ts'
import type { Clock } from './clock.ts'
import { Host } from './host.ts'
import { formatLogins, LOGIN_RECORDS_PATH, parseLogins, type LoginRecord } from './logins.ts'
import type { DirSpec, FileSpec, HostSpec, LoginSpec, OverlaySpec, ProcessSpec, TouchSpec } from './spec.ts'
import { formatGroup, formatPasswd } from './users.ts'

export interface BuildOptions {
  clock: Clock
  /** The commands to install on the host. */
  programs: ProgramRegistry
}

/** Owner and group names become ids, checked against the host's own account files. */
function ownership(
  host: Host,
  spec: { path: string; owner: string; group?: string | undefined },
): { uid: number; gid: number } {
  const user = host.users.byName(spec.owner)
  if (!user) throw new Error(`${spec.path}: no such user "${spec.owner}" on ${host.name}`)
  if (spec.group === undefined) return { uid: user.uid, gid: user.gid }
  const group = host.users.groupByName(spec.group)
  if (!group) throw new Error(`${spec.path}: no such group "${spec.group}" on ${host.name}`)
  return { uid: user.uid, gid: group.gid }
}

function installDirs(host: Host, dirs: readonly DirSpec[], mtime: number | undefined): void {
  for (const dir of dirs) {
    const when = dir.mtime ?? mtime
    host.fs.installDir(dir.path, {
      ...ownership(host, dir),
      ...(dir.mode === undefined ? {} : { mode: dir.mode }),
      ...(when === undefined ? {} : { mtime: when }),
    })
  }
}

function installFiles(
  host: Host,
  files: readonly FileSpec[],
  programs: ProgramRegistry | undefined,
  mtime: number | undefined,
): void {
  for (const file of files) {
    if (file.file !== undefined) {
      throw new Error(`${file.path}: its content file "${file.file}" has not been read in (use the loader)`)
    }
    const when = file.mtime ?? mtime
    let program: { program: string; size: number } | undefined
    if (file.program !== undefined) {
      // A copy of an installed command: take its identity from the original.
      const original = programs?.get(file.program)
      const stat = original ? host.fs.inspect(original.path) : undefined
      if (!stat?.program) {
        throw new Error(`${file.path}: "${file.program}" is not a command installed on ${host.name}`)
      }
      program = { program: stat.program, size: stat.size }
    }
    host.fs.install(file.path, {
      ...ownership(host, file),
      content: file.content,
      ...(file.mode === undefined ? (program ? { mode: 0o755 } : {}) : { mode: file.mode }),
      ...(when === undefined ? {} : { mtime: when }),
      ...program,
    })
  }
}

function setModifiedTimes(host: Host, touches: readonly TouchSpec[]): void {
  for (const touch of touches) {
    if (!host.fs.setModified(touch.path, touch.mtime)) {
      throw new Error(`touch ${touch.path}: nothing there on ${host.name}`)
    }
  }
}

function addLogins(host: Host, logins: readonly LoginSpec[]): void {
  if (logins.length === 0) return
  const existing = parseLogins(host.fs.peek(LOGIN_RECORDS_PATH) ?? '')
  const added: LoginRecord[] = logins.map((l) => ({
    user: l.user,
    tty: l.tty,
    from: l.from,
    login: l.login,
    ...(l.logout === undefined ? {} : { logout: l.logout }),
  }))
  // Records are kept in the order the logins happened, as a real log would be.
  const all = [...existing, ...added].sort((a, b) => a.login - b.login)
  const previous = host.fs.inspect(LOGIN_RECORDS_PATH)
  host.fs.install(LOGIN_RECORDS_PATH, {
    content: formatLogins(all),
    mode: previous?.mode ?? 0o644,
    uid: previous?.uid ?? 0,
    gid: previous?.gid ?? 0,
    mtime: Math.max(...all.map((r) => r.logout ?? r.login)),
  })
}

function addProcesses(host: Host, processes: readonly ProcessSpec[]): void {
  for (const p of processes) {
    const user = host.users.byName(p.user)
    if (!user) throw new Error(`process ${p.pid}: no such user "${p.user}" on ${host.name}`)
    host.processes = host.processes.filter((existing) => existing.pid !== p.pid)
    host.processes.push({
      pid: p.pid,
      uid: user.uid,
      tty: p.tty,
      stat: p.stat,
      time: p.time,
      command: p.command,
    })
  }
}

/**
 * Build a host from its description: commands, accounts, home directories,
 * then the listed directories and files, login records and processes. Files
 * listed explicitly win over generated ones, so a description may supply its
 * own /etc/passwd.
 */
export function buildHost(spec: HostSpec, options: BuildOptions): Host {
  const host = new Host({ name: spec.name, clock: options.clock, timezone: spec.timezone })
  const installed = spec.installed

  installPrograms(host.fs, options.programs, installed)

  const groupIds = new Map(spec.groups.map((g) => [g.name, g.gid]))
  const users = spec.users.map((u) => {
    const gid = groupIds.get(u.group)
    if (gid === undefined) throw new Error(`user ${u.name}: no such group "${u.group}"`)
    return {
      name: u.name,
      password: u.password,
      uid: u.uid,
      gid,
      gecos: u.gecos,
      home: u.home ?? `/home/${u.name}`,
      shell: u.shell,
    }
  })

  const system = installed === undefined ? {} : { mtime: installed }
  host.fs.install('/etc/passwd', { content: formatPasswd(users), mode: 0o644, ...system })
  host.fs.install('/etc/group', { content: formatGroup(spec.groups), mode: 0o644, ...system })

  for (const user of users) {
    if (user.home === '/') continue
    host.fs.installDir(user.home, { uid: user.uid, gid: user.gid, mode: 0o755, ...system })
  }

  installDirs(host, spec.dirs, installed)
  installFiles(host, spec.files, options.programs, installed)
  setModifiedTimes(host, spec.touch)
  addLogins(host, spec.logins)
  addProcesses(host, spec.processes)
  return host
}

/**
 * Change an existing host the way a level asks: remove paths, then add or
 * replace directories, files, modified times, login records and processes. This is setup, not
 * play: nothing here is reported as file access.
 */
export function applyOverlay(host: Host, overlay: OverlaySpec, programs?: ProgramRegistry): void {
  for (const path of overlay.remove) host.fs.uninstall(path)
  installDirs(host, overlay.dirs, undefined)
  installFiles(host, overlay.files, programs, undefined)
  setModifiedTimes(host, overlay.touch)
  addLogins(host, overlay.logins)
  host.processes = host.processes.filter((p) => !overlay.endProcesses.includes(p.pid))
  addProcesses(host, overlay.processes)
}

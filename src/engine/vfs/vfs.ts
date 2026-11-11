import { basename, dirname, normalize, split } from './path.ts'
import {
  ROOT_UID,
  S_ISGID,
  S_ISUID,
  S_ISVTX,
  VfsError,
  type Access,
  type AccessEvent,
  type AccessOp,
  type Credentials,
  type SerializedNode,
  type Stat,
} from './types.ts'

interface BaseNode {
  mode: number
  uid: number
  gid: number
  mtime: number
}

interface FileNode extends BaseNode {
  kind: 'file'
  content: string
  /** Set on compiled programs: the name of the implementation the shell runs. */
  program?: string
  /** Size to report for compiled programs, whose content is not real text. */
  size?: number
}

interface DirNode extends BaseNode {
  kind: 'dir'
  children: Map<string, VNode>
}

type VNode = FileNode | DirNode

export interface VfsOptions {
  /** Current time in seconds on the in-game clock. */
  now: () => number
}

/** Everything about a file that a privileged installer may set. */
export interface FileSpec {
  content?: string
  mode?: number
  uid?: number
  gid?: number
  mtime?: number
  program?: string
  size?: number
}

export interface DirSpec {
  mode?: number
  uid?: number
  gid?: number
  mtime?: number
}

export interface WriteOptions {
  append?: boolean
  /** Mode for a newly created file. Ignored when the file already exists. */
  mode?: number
  /** Mark the result as a compiled program. Used when copying one. */
  program?: string
  /** Reported size of a compiled program. */
  size?: number
}

const DEFAULT_FILE_MODE = 0o644
const DEFAULT_DIR_MODE = 0o755

/** The permission triplet (rwx as 0–7) that applies to this caller. */
function classBits(node: BaseNode, cred: Credentials): number {
  if (cred.uid === node.uid) return (node.mode >> 6) & 7
  if (cred.gid === node.gid || cred.groups.includes(node.gid)) return (node.mode >> 3) & 7
  return node.mode & 7
}

/**
 * The classic Unix permission check. Exactly one class applies (owner, then
 * group, then other), so an owner with no access is denied even when "other"
 * is allowed. Root passes everything except executing a file with no execute
 * bit at all.
 */
function permits(node: VNode, cred: Credentials, want: Access): boolean {
  if (cred.uid === ROOT_UID) {
    if (want !== 'x') return true
    return node.kind === 'dir' || (node.mode & 0o111) !== 0
  }
  const mask = want === 'r' ? 4 : want === 'w' ? 2 : 1
  return (classBits(node, cred) & mask) !== 0
}

function statOf(node: VNode): Stat {
  const stat: Stat = {
    kind: node.kind,
    mode: node.mode,
    uid: node.uid,
    gid: node.gid,
    mtime: node.mtime,
    // Directories report one disk block, as they did on the real thing.
    size: node.kind === 'file' ? (node.size ?? node.content.length) : 512,
  }
  if (node.kind === 'file' && node.program !== undefined) stat.program = node.program
  return stat
}

function serialize(node: VNode): SerializedNode {
  if (node.kind === 'file') {
    const out: SerializedNode = {
      kind: 'file',
      mode: node.mode,
      uid: node.uid,
      gid: node.gid,
      mtime: node.mtime,
      content: node.content,
    }
    if (node.program !== undefined) out.program = node.program
    if (node.size !== undefined) out.size = node.size
    return out
  }
  const children: Record<string, SerializedNode> = {}
  for (const name of [...node.children.keys()].sort()) {
    children[name] = serialize(node.children.get(name)!)
  }
  return { kind: 'dir', mode: node.mode, uid: node.uid, gid: node.gid, mtime: node.mtime, children }
}

function deserialize(data: SerializedNode): VNode {
  if (data.kind === 'file') {
    const node: FileNode = {
      kind: 'file',
      mode: data.mode,
      uid: data.uid,
      gid: data.gid,
      mtime: data.mtime,
      content: data.content,
    }
    if (data.program !== undefined) node.program = data.program
    if (data.size !== undefined) node.size = data.size
    return node
  }
  const children = new Map<string, VNode>()
  for (const [name, child] of Object.entries(data.children)) {
    children.set(name, deserialize(child))
  }
  return { kind: 'dir', mode: data.mode, uid: data.uid, gid: data.gid, mtime: data.mtime, children }
}

/**
 * An in-memory Unix filesystem for one host.
 *
 * Every public operation takes the caller's credentials and enforces
 * permissions the way 4.2BSD did. Paths must be absolute; the shell resolves
 * relative paths before calling in. Failures throw `VfsError`.
 */
export class Vfs {
  private root: DirNode
  private readonly now: () => number
  private readonly listeners = new Set<(event: AccessEvent) => void>()

  constructor(options: VfsOptions) {
    this.now = options.now
    this.root = {
      kind: 'dir',
      mode: DEFAULT_DIR_MODE,
      uid: ROOT_UID,
      gid: 0,
      mtime: options.now(),
      children: new Map(),
    }
  }

  // ---- observation -------------------------------------------------------

  /** Watch successful operations. Returns a function that stops watching. */
  subscribe(listener: (event: AccessEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(op: AccessOp, path: string, cred: Credentials): void {
    if (this.listeners.size === 0) return
    const event: AccessEvent = { op, path: normalize(path), uid: cred.uid }
    for (const listener of this.listeners) listener(event)
  }

  // ---- lookup ------------------------------------------------------------

  /** Walk to a node, requiring search (x) permission on every directory passed through. */
  private walk(path: string, cred: Credentials): VNode {
    let node: VNode = this.root
    for (const part of split(path)) {
      if (node.kind !== 'dir') throw new VfsError('ENOTDIR', path)
      if (!permits(node, cred, 'x')) throw new VfsError('EACCES', path)
      const child = node.children.get(part)
      if (!child) throw new VfsError('ENOENT', path)
      node = child
    }
    return node
  }

  /** The directory that holds `path`, plus the final name. */
  private parentOf(path: string, cred: Credentials): { dir: DirNode; name: string } {
    const name = basename(normalize(path))
    if (name === '/') throw new VfsError('EINVAL', path)
    const dir = this.walk(dirname(path), cred)
    if (dir.kind !== 'dir') throw new VfsError('ENOTDIR', path)
    if (!permits(dir, cred, 'x')) throw new VfsError('EACCES', path)
    return { dir, name }
  }

  /**
   * May this caller add or remove entries in `dir`? Needs write and search on
   * the directory. In a sticky directory (like /tmp) only the entry's owner,
   * the directory's owner or root may remove or replace an existing entry.
   */
  private checkDirWrite(
    dir: DirNode,
    cred: Credentials,
    path: string,
    existing: VNode | undefined,
  ): void {
    if (!permits(dir, cred, 'w') || !permits(dir, cred, 'x')) throw new VfsError('EACCES', path)
    if (
      existing &&
      dir.mode & S_ISVTX &&
      cred.uid !== ROOT_UID &&
      cred.uid !== existing.uid &&
      cred.uid !== dir.uid
    ) {
      throw new VfsError('EPERM', path)
    }
  }

  // ---- reading -----------------------------------------------------------

  stat(path: string, cred: Credentials): Stat {
    const node = this.walk(path, cred)
    this.emit('stat', path, cred)
    return statOf(node)
  }

  /** Like `stat`, but returns undefined when the path does not exist. */
  tryStat(path: string, cred: Credentials): Stat | undefined {
    try {
      return this.stat(path, cred)
    } catch (err) {
      if (err instanceof VfsError && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
        return undefined
      }
      throw err
    }
  }

  /** Would this caller be allowed this kind of access? False if the path cannot be reached. */
  access(path: string, cred: Credentials, want: Access): boolean {
    try {
      return permits(this.walk(path, cred), cred, want)
    } catch (err) {
      if (err instanceof VfsError) return false
      throw err
    }
  }

  readFile(path: string, cred: Credentials): string {
    const node = this.walk(path, cred)
    if (node.kind === 'dir') throw new VfsError('EISDIR', path)
    if (!permits(node, cred, 'r')) throw new VfsError('EACCES', path)
    this.emit('read', path, cred)
    return node.content
  }

  /** Names in a directory, sorted. Does not include `.` or `..`. */
  readdir(path: string, cred: Credentials): string[] {
    const node = this.walk(path, cred)
    if (node.kind !== 'dir') throw new VfsError('ENOTDIR', path)
    if (!permits(node, cred, 'r')) throw new VfsError('EACCES', path)
    this.emit('list', path, cred)
    return [...node.children.keys()].sort()
  }

  // ---- writing -----------------------------------------------------------

  /**
   * Replace or append to a file, creating it if needed. A new file belongs to
   * the caller and takes the directory's group (BSD behaviour). Writing to a
   * setuid or setgid file as anyone but root clears those bits.
   */
  writeFile(path: string, content: string, cred: Credentials, options: WriteOptions = {}): void {
    const { dir, name } = this.parentOf(path, cred)
    const existing = dir.children.get(name)
    const now = this.now()

    if (existing) {
      if (existing.kind === 'dir') throw new VfsError('EISDIR', path)
      if (!permits(existing, cred, 'w')) throw new VfsError('EACCES', path)
      existing.content = options.append ? existing.content + content : content
      existing.mtime = now
      // A compiled program that gets overwritten with text is just a text
      // file now; overwritten with another program, it becomes that program.
      delete existing.program
      delete existing.size
      if (options.program !== undefined) existing.program = options.program
      if (options.size !== undefined) existing.size = options.size
      if (cred.uid !== ROOT_UID) existing.mode &= ~(S_ISUID | S_ISGID)
      this.emit('write', path, cred)
      return
    }

    this.checkDirWrite(dir, cred, path, undefined)
    const created: FileNode = {
      kind: 'file',
      mode: (options.mode ?? DEFAULT_FILE_MODE) & 0o7777,
      uid: cred.uid,
      gid: dir.gid,
      mtime: now,
      content,
    }
    if (options.program !== undefined) created.program = options.program
    if (options.size !== undefined) created.size = options.size
    dir.children.set(name, created)
    dir.mtime = now
    this.emit('create', path, cred)
  }

  mkdir(path: string, cred: Credentials, mode: number = DEFAULT_DIR_MODE): void {
    const { dir, name } = this.parentOf(path, cred)
    if (dir.children.has(name)) throw new VfsError('EEXIST', path)
    this.checkDirWrite(dir, cred, path, undefined)
    const now = this.now()
    dir.children.set(name, {
      kind: 'dir',
      mode: mode & 0o7777,
      uid: cred.uid,
      gid: dir.gid,
      mtime: now,
      children: new Map(),
    })
    dir.mtime = now
    this.emit('create', path, cred)
  }

  /** Remove a file. Permission comes from the directory, not the file. */
  unlink(path: string, cred: Credentials): void {
    const { dir, name } = this.parentOf(path, cred)
    const node = dir.children.get(name)
    if (!node) throw new VfsError('ENOENT', path)
    if (node.kind === 'dir') throw new VfsError('EISDIR', path)
    this.checkDirWrite(dir, cred, path, node)
    dir.children.delete(name)
    dir.mtime = this.now()
    this.emit('remove', path, cred)
  }

  /** Remove an empty directory. */
  rmdir(path: string, cred: Credentials): void {
    const { dir, name } = this.parentOf(path, cred)
    const node = dir.children.get(name)
    if (!node) throw new VfsError('ENOENT', path)
    if (node.kind !== 'dir') throw new VfsError('ENOTDIR', path)
    if (node.children.size > 0) throw new VfsError('ENOTEMPTY', path)
    this.checkDirWrite(dir, cred, path, node)
    dir.children.delete(name)
    dir.mtime = this.now()
    this.emit('remove', path, cred)
  }

  /**
   * Move a node. It keeps its owner, group, mode and modified time: only the
   * two directories change. An existing file at the destination is replaced.
   */
  rename(from: string, to: string, cred: Credentials): void {
    const source = this.parentOf(from, cred)
    const node = source.dir.children.get(source.name)
    if (!node) throw new VfsError('ENOENT', from)

    const fromPath = normalize(from)
    const toPath = normalize(to)
    if (fromPath === toPath) return
    if (node.kind === 'dir' && toPath.startsWith(fromPath + '/')) throw new VfsError('EINVAL', to)

    const target = this.parentOf(to, cred)
    const existing = target.dir.children.get(target.name)
    if (existing) {
      if (existing.kind === 'dir' && node.kind === 'file') throw new VfsError('EISDIR', to)
      if (existing.kind === 'file' && node.kind === 'dir') throw new VfsError('ENOTDIR', to)
      if (existing.kind === 'dir' && existing.children.size > 0) {
        throw new VfsError('ENOTEMPTY', to)
      }
    }

    this.checkDirWrite(source.dir, cred, from, node)
    this.checkDirWrite(target.dir, cred, to, existing)

    const now = this.now()
    source.dir.children.delete(source.name)
    target.dir.children.set(target.name, node)
    source.dir.mtime = now
    target.dir.mtime = now
    this.emit('rename', from, cred)
    this.emit(existing ? 'write' : 'create', to, cred)
  }

  /** Change mode bits. Only the owner or root may. */
  chmod(path: string, mode: number, cred: Credentials): void {
    const node = this.walk(path, cred)
    if (cred.uid !== ROOT_UID && cred.uid !== node.uid) throw new VfsError('EPERM', path)
    node.mode = mode & 0o7777
    this.emit('chmod', path, cred)
  }

  /** Change owner and group. Root only. Clears setuid and setgid, as Unix does. */
  chown(path: string, uid: number, gid: number, cred: Credentials): void {
    const node = this.walk(path, cred)
    if (cred.uid !== ROOT_UID) throw new VfsError('EPERM', path)
    node.uid = uid
    node.gid = gid
    node.mode &= ~(S_ISUID | S_ISGID)
    this.emit('chown', path, cred)
  }

  // ---- privileged setup --------------------------------------------------
  // Used to build a host from level data. No permission checks, no events.

  /** Create or replace a file with exact metadata, creating parent directories as needed. */
  install(path: string, spec: FileSpec = {}): void {
    const full = normalize(path)
    const name = basename(full)
    if (name === '/') throw new VfsError('EINVAL', path)
    const dir = this.ensureDir(dirname(full), spec.mtime)
    const node: FileNode = {
      kind: 'file',
      mode: (spec.mode ?? DEFAULT_FILE_MODE) & 0o7777,
      uid: spec.uid ?? ROOT_UID,
      gid: spec.gid ?? 0,
      mtime: spec.mtime ?? this.now(),
      content: spec.content ?? '',
    }
    if (spec.program !== undefined) node.program = spec.program
    if (spec.size !== undefined) node.size = spec.size
    if (dir.children.get(name)?.kind === 'dir') throw new VfsError('EISDIR', path)
    dir.children.set(name, node)
  }

  /** Create a directory (and its parents), or update the metadata of an existing one. */
  installDir(path: string, spec: DirSpec = {}): void {
    const dir = this.ensureDir(normalize(path), spec.mtime)
    if (spec.mode !== undefined) dir.mode = spec.mode & 0o7777
    if (spec.uid !== undefined) dir.uid = spec.uid
    if (spec.gid !== undefined) dir.gid = spec.gid
    if (spec.mtime !== undefined) dir.mtime = spec.mtime
  }

  /**
   * Read a file as the system itself: no permission check and no event.
   * For engine bookkeeping (such as reading the account list), never for
   * anything done on a player's behalf. Undefined if there is no such file.
   */
  peek(path: string): string | undefined {
    const node = this.find(path)
    return node?.kind === 'file' ? node.content : undefined
  }

  /** Metadata for a path, as the system itself: no permission check, no event. */
  inspect(path: string): Stat | undefined {
    const node = this.find(path)
    return node ? statOf(node) : undefined
  }

  /** Names in a directory, sorted, as the system itself. Undefined if it is not a directory. */
  entries(path: string): string[] | undefined {
    const node = this.find(path)
    return node?.kind === 'dir' ? [...node.children.keys()].sort() : undefined
  }

  /**
   * Delete a file, or a directory with everything in it, as the system
   * itself. Returns false if there was nothing there. The root cannot go.
   */
  uninstall(path: string): boolean {
    const parts = split(path)
    const name = parts.pop()
    if (name === undefined) return false
    const parent = this.find('/' + parts.join('/'))
    if (parent?.kind !== 'dir') return false
    return parent.children.delete(name)
  }

  private find(path: string): VNode | undefined {
    let node: VNode = this.root
    for (const part of split(path)) {
      if (node.kind !== 'dir') return undefined
      const child = node.children.get(part)
      if (!child) return undefined
      node = child
    }
    return node
  }

  private ensureDir(path: string, mtime: number | undefined): DirNode {
    let node: DirNode = this.root
    for (const part of split(path)) {
      let child = node.children.get(part)
      if (!child) {
        child = {
          kind: 'dir',
          mode: DEFAULT_DIR_MODE,
          uid: ROOT_UID,
          gid: 0,
          mtime: mtime ?? this.now(),
          children: new Map(),
        }
        node.children.set(part, child)
      }
      if (child.kind !== 'dir') throw new VfsError('ENOTDIR', path)
      node = child
    }
    return node
  }

  // ---- saving and cloning ------------------------------------------------

  /** The whole tree as plain data. Key order is stable, so equal trees serialize equally. */
  snapshot(): SerializedNode {
    return serialize(this.root)
  }

  static fromSnapshot(snapshot: SerializedNode, options: VfsOptions): Vfs {
    if (snapshot.kind !== 'dir') throw new VfsError('ENOTDIR', '/')
    const vfs = new Vfs(options)
    vfs.root = deserialize(snapshot) as DirNode
    return vfs
  }

  /** An independent copy. Changes to one never show up in the other. */
  clone(options: VfsOptions = { now: this.now }): Vfs {
    return Vfs.fromSnapshot(this.snapshot(), options)
  }
}

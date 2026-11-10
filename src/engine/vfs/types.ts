/** Who is asking. The filesystem only ever sees effective credentials. */
export interface Credentials {
  uid: number
  /** Primary group. */
  gid: number
  /** Every group the user belongs to, including the primary group. */
  groups: readonly number[]
}

export const ROOT_UID = 0

export const ROOT: Credentials = { uid: ROOT_UID, gid: 0, groups: [0] }

/** Special mode bits above the nine permission bits. */
export const S_ISUID = 0o4000
export const S_ISGID = 0o2000
export const S_ISVTX = 0o1000

export type Access = 'r' | 'w' | 'x'

export type NodeKind = 'file' | 'dir'

/** A snapshot of one node's metadata. Never a live reference. */
export interface Stat {
  kind: NodeKind
  /** Permission and special bits, 0o0000 to 0o7777. */
  mode: number
  uid: number
  gid: number
  /** Modified time in seconds on the in-game clock. */
  mtime: number
  size: number
  /** For compiled programs: the name of the implementation to run. */
  program?: string
}

export type VfsErrorCode =
  | 'ENOENT'
  | 'EACCES'
  | 'EPERM'
  | 'EISDIR'
  | 'ENOTDIR'
  | 'EEXIST'
  | 'ENOTEMPTY'
  | 'EINVAL'

/** Period wording: 4.2BSD printed "Not owner" for EPERM. */
const MESSAGES: Record<VfsErrorCode, string> = {
  ENOENT: 'No such file or directory',
  EACCES: 'Permission denied',
  EPERM: 'Not owner',
  EISDIR: 'Is a directory',
  ENOTDIR: 'Not a directory',
  EEXIST: 'File exists',
  ENOTEMPTY: 'Directory not empty',
  EINVAL: 'Invalid argument',
}

export class VfsError extends Error {
  readonly code: VfsErrorCode
  readonly path: string

  constructor(code: VfsErrorCode, path: string) {
    super(MESSAGES[code])
    this.name = 'VfsError'
    this.code = code
    this.path = path
  }
}

/** What the filesystem reports to observers, so levels can ask "was this file looked at?" */
export type AccessOp =
  | 'stat'
  | 'read'
  | 'list'
  | 'write'
  | 'create'
  | 'remove'
  | 'rename'
  | 'chmod'
  | 'chown'

export interface AccessEvent {
  op: AccessOp
  path: string
  uid: number
}

/** Plain-data form of a node, used for saves and for cloning a host. */
export type SerializedNode =
  | {
      kind: 'file'
      mode: number
      uid: number
      gid: number
      mtime: number
      content: string
      program?: string
      size?: number
    }
  | {
      kind: 'dir'
      mode: number
      uid: number
      gid: number
      mtime: number
      children: Record<string, SerializedNode>
    }

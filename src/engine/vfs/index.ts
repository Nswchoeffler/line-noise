export { Vfs, type DirSpec, type FileSpec, type VfsOptions, type WriteOptions } from './vfs.ts'
export { applyModeSpec, formatMode, ModeSpecError } from './mode.ts'
export { basename, dirname, join, normalize, resolve, split } from './path.ts'
export {
  ROOT,
  ROOT_UID,
  S_ISGID,
  S_ISUID,
  S_ISVTX,
  VfsError,
  type Access,
  type AccessEvent,
  type AccessOp,
  type Credentials,
  type NodeKind,
  type SerializedNode,
  type Stat,
  type VfsErrorCode,
} from './types.ts'

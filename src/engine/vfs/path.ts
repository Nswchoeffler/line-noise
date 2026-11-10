import { VfsError } from './types.ts'

/** Components of an absolute path, with `.`, `..` and empty parts resolved. */
export function split(path: string): string[] {
  if (!path.startsWith('/')) throw new VfsError('EINVAL', path)
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out
}

/** Canonical form of an absolute path: no trailing slash, no `.` or `..`. */
export function normalize(path: string): string {
  return '/' + split(path).join('/')
}

/** Resolve a path that may be relative against a working directory. */
export function resolve(cwd: string, path: string): string {
  if (path === '') return normalize(cwd)
  return normalize(path.startsWith('/') ? path : `${cwd}/${path}`)
}

export function join(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/')
}

/** Parent of a normalized absolute path. The parent of `/` is `/`. */
export function dirname(path: string): string {
  const parts = split(path)
  parts.pop()
  return '/' + parts.join('/')
}

/** Last component of a path. The basename of `/` is `/`. */
export function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  if (trimmed === '') return '/'
  return trimmed.slice(trimmed.lastIndexOf('/') + 1)
}

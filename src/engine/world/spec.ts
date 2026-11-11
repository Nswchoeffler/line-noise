// The data format for describing a host. Content files are YAML; these
// schemas check them and turn friendly values ("4755", "1986-09-09 03:02",
// owner names) into what the engine uses.

import { z } from 'zod'
import { parseTime } from './time.ts'

/** A file mode written in octal, such as "644" or "4755". Unquoted numbers work too. */
export const ModeSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value))
  .refine((text) => /^[0-7]{3,4}$/.test(text), {
    message: 'a mode is three or four octal digits, such as "644" or "4755"',
  })
  .transform((text) => parseInt(text, 8))

/** A time written as "YYYY-MM-DD HH:MM" or "YYYY-MM-DD HH:MM:SS". */
export const TimeSchema = z.string().transform((text, ctx) => {
  try {
    return parseTime(text)
  } catch {
    ctx.addIssue({ code: 'custom', message: `"${text}" is not a time (use YYYY-MM-DD HH:MM)` })
    return z.NEVER
  }
})

export const UserSpecSchema = z.strictObject({
  name: z.string().min(1),
  uid: z.number().int().min(0),
  /** Primary group, by name. */
  group: z.string(),
  /** Full name and office details. */
  gecos: z.string().default(''),
  /** Defaults to /home/<name>. Created automatically, owned by the user. */
  home: z.string().optional(),
  shell: z.string().default('/bin/sh'),
  /** The password field of /etc/passwd: a hash, or "*" for no login. */
  password: z.string().default('*'),
})

export const GroupSpecSchema = z.strictObject({
  name: z.string().min(1),
  gid: z.number().int().min(0),
  members: z.array(z.string()).default([]),
})

export const DirSpecSchema = z.strictObject({
  path: z.string().startsWith('/'),
  owner: z.string().default('root'),
  /** Defaults to the owner's primary group. */
  group: z.string().optional(),
  mode: ModeSchema.optional(),
  mtime: TimeSchema.optional(),
})

export const FileSpecSchema = z
  .strictObject({
    path: z.string().startsWith('/'),
    owner: z.string().default('root'),
    group: z.string().optional(),
    mode: ModeSchema.optional(),
    mtime: TimeSchema.optional(),
    content: z.string().default(''),
    /**
     * Take the content from another content file, such as `world/files/ledger`.
     * For long files that are easier to keep on their own. The loader reads it in.
     */
    file: z.string().optional(),
    /** Make this file a copy of an engine command, such as a second `sh`. */
    program: z.string().optional(),
  })
  .refine((f) => f.file === undefined || f.content === '', {
    message: 'give either "content" or "file", not both',
  })

export const LoginSpecSchema = z.strictObject({
  user: z.string(),
  tty: z.string(),
  /** Where the connection came from. Leave out for a local terminal. */
  from: z.string().default(''),
  login: TimeSchema,
  /** Leave out while the session is still open. */
  logout: TimeSchema.optional(),
})

export const ProcessSpecSchema = z.strictObject({
  pid: z.number().int().min(1),
  user: z.string(),
  tty: z.string().nullable().default(null),
  stat: z.string().default('S'),
  time: z.string().default('0:00'),
  command: z.string(),
})

/** A whole host, built from nothing. */
export const HostSpecSchema = z.strictObject({
  name: z.string().min(1),
  timezone: z.string().default('UTC'),
  /** Modified time given to system files that do not set their own. */
  installed: TimeSchema.optional(),
  users: z.array(UserSpecSchema).default([]),
  groups: z.array(GroupSpecSchema).default([]),
  dirs: z.array(DirSpecSchema).default([]),
  files: z.array(FileSpecSchema).default([]),
  logins: z.array(LoginSpecSchema).default([]),
  processes: z.array(ProcessSpecSchema).default([]),
})

/** Changes to an existing host: what a level adds, replaces or removes. */
export const OverlaySpecSchema = z.strictObject({
  /** Paths to delete. Directories go with everything in them. */
  remove: z.array(z.string().startsWith('/')).default([]),
  dirs: z.array(DirSpecSchema).default([]),
  files: z.array(FileSpecSchema).default([]),
  logins: z.array(LoginSpecSchema).default([]),
  processes: z.array(ProcessSpecSchema).default([]),
  /** Process ids to drop from the table. */
  endProcesses: z.array(z.number().int()).default([]),
})

export type UserSpec = z.infer<typeof UserSpecSchema>
export type GroupSpec = z.infer<typeof GroupSpecSchema>
export type DirSpec = z.infer<typeof DirSpecSchema>
export type FileSpec = z.infer<typeof FileSpecSchema>
export type LoginSpec = z.infer<typeof LoginSpecSchema>
export type ProcessSpec = z.infer<typeof ProcessSpecSchema>
export type HostSpec = z.infer<typeof HostSpecSchema>
export type OverlaySpec = z.infer<typeof OverlaySpecSchema>

/** Check data against a schema. Failures name the file and the field, for whoever wrote the content. */
export function parseSpec<S extends z.ZodType>(schema: S, data: unknown, label: string): z.infer<S> {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw new Error(`${label} is not valid:\n${z.prettifyError(result.error)}`)
  }
  return result.data
}

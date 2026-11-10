import type { Program, ProgramRegistry } from '../types.ts'
import { cat } from './cat.ts'
import { clear } from './clear.ts'
import { echo } from './echo.ts'
import { pwd } from './pwd.ts'
import { sh } from './sh.ts'
import { whoami } from './whoami.ts'

const ALL: Program[] = [cat, clear, echo, pwd, sh, whoami]

/** Every command the engine provides, by name. */
export const programs: ProgramRegistry = new Map(ALL.map((p) => [p.name, p]))

import type { Program, ProgramRegistry } from '../types.ts'
import { cat } from './cat.ts'
import { chmod } from './chmod.ts'
import { clear } from './clear.ts'
import { cp } from './cp.ts'
import { echo } from './echo.ts'
import { ls } from './ls.ts'
import { mv } from './mv.ts'
import { pwd } from './pwd.ts'
import { rm } from './rm.ts'
import { sh } from './sh.ts'
import { whoami } from './whoami.ts'

const ALL: Program[] = [cat, chmod, clear, cp, echo, ls, mv, pwd, rm, sh, whoami]

/** Every command the engine provides, by name. */
export const programs: ProgramRegistry = new Map(ALL.map((p) => [p.name, p]))

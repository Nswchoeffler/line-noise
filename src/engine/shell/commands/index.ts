import type { Program, ProgramRegistry } from '../types.ts'
import { cat } from './cat.ts'
import { chmod } from './chmod.ts'
import { clear } from './clear.ts'
import { cp } from './cp.ts'
import { cut } from './cut.ts'
import { date } from './date.ts'
import { diff } from './diff.ts'
import { echo } from './echo.ts'
import { finger } from './finger.ts'
import { grep } from './grep.ts'
import { head, tail } from './head.ts'
import { ls } from './ls.ts'
import { man } from './man.ts'
import { more } from './more.ts'
import { mv } from './mv.ts'
import { ps } from './ps.ts'
import { pwd } from './pwd.ts'
import { rm } from './rm.ts'
import { sh } from './sh.ts'
import { sort } from './sort.ts'
import { uniq } from './uniq.ts'
import { wc } from './wc.ts'
import { last, who } from './who.ts'
import { whoami } from './whoami.ts'

const ALL: Program[] = [
  cat,
  chmod,
  clear,
  cp,
  cut,
  date,
  diff,
  echo,
  finger,
  grep,
  head,
  last,
  ls,
  man,
  more,
  mv,
  ps,
  pwd,
  rm,
  sh,
  sort,
  tail,
  uniq,
  wc,
  who,
  whoami,
]

/** Every command the engine provides, by name. */
export const programs: ProgramRegistry = new Map(ALL.map((p) => [p.name, p]))

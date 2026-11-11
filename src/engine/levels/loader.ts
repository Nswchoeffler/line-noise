import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import type { ProgramRegistry } from '../shell/types.ts'
import { applyOverlay, buildHost } from '../world/build.ts'
import { HostSpecSchema, parseSpec, TimeSchema, type FileSpec, type HostSpec } from '../world/spec.ts'
import { World } from '../world/world.ts'
import { CardSchema, LevelSchema, type Card, type Level, type TrayItem } from './schema.ts'

/** Where content comes from: given a path such as `levels/L01.yaml`, the file's text. */
export type ContentSource = (path: string) => string

/** The top-level file that ties a game together. */
export const GameSchema = z.strictObject({
  title: z.string(),
  /** When the story starts. */
  start: TimeSchema,
  /** The terminal the player sits at. */
  tty: z.string().default('ttyp0'),
  /** Host description files. */
  hosts: z.array(z.string()).min(1),
  /** Level files, in play order. */
  levels: z.array(z.string()).min(1),
  /** One line for the credits screen. */
  credits: z.strictObject({ text: z.string(), url: z.string().url() }).optional(),
})

export type Game = z.infer<typeof GameSchema>

/** A level with everything it refers to already read in. */
export interface LoadedLevel {
  level: Level
  card: Card
  /** Everything that can land in the printout tray during this level. */
  tray: TrayItem[]
}

export interface LoadedGame {
  game: Game
  hosts: HostSpec[]
  levels: LoadedLevel[]
}

function readYaml(source: ContentSource, path: string): unknown {
  let text: string
  try {
    text = source(path)
  } catch {
    throw new Error(`content file not found: ${path}`)
  }
  try {
    return parseYaml(text)
  } catch (err) {
    throw new Error(`${path} is not valid YAML: ${(err as Error).message}`)
  }
}

/** Read in the contents of files that are kept in content files of their own. */
function readFileContents(source: ContentSource, files: FileSpec[], label: string): void {
  for (const file of files) {
    if (file.file === undefined) continue
    try {
      file.content = source(file.file)
    } catch {
      throw new Error(`${label}: ${file.path}: content file not found: ${file.file}`)
    }
    delete file.file
  }
}

export function loadLevel(source: ContentSource, path: string): LoadedLevel {
  const level = parseSpec(LevelSchema, readYaml(source, path), path)
  for (const overlay of Object.values(level.setup.overlays)) readFileContents(source, overlay.files, path)
  const card = parseSpec(CardSchema, readYaml(source, level.debrief), level.debrief)
  return { level, card, tray: [...level.tray] }
}

/** Read a whole game: its hosts and every level, checked for consistency. */
export function loadGame(source: ContentSource, path = 'game.yaml'): LoadedGame {
  const game = parseSpec(GameSchema, readYaml(source, path), path)
  const hosts = game.hosts.map((file) => {
    const host = parseSpec(HostSpecSchema, readYaml(source, file), file)
    readFileContents(source, host.files, file)
    return host
  })
  const levels = game.levels.map((file) => loadLevel(source, file))

  const ids = levels.map((l) => l.level.id)
  for (const id of ids) {
    if (ids.indexOf(id) !== ids.lastIndexOf(id)) throw new Error(`level id used twice: ${id}`)
  }
  levels.forEach((loaded, index) => {
    if (loaded.level.number !== index + 1) {
      throw new Error(`${loaded.level.id} is level ${index + 1} in ${path} but says number ${loaded.level.number}`)
    }
  })
  return { game, hosts, levels }
}

/** Apply one level's setup to a world: overlays, cloned hosts, then the clock. */
export function applySetup(world: World, loaded: LoadedLevel, programs: ProgramRegistry): void {
  const { setup, id } = loaded.level
  const clones = new Set(Object.keys(setup.clone))

  // Hosts that already exist are changed first, so a clone copies the result.
  for (const [hostName, overlay] of Object.entries(setup.overlays)) {
    if (clones.has(hostName)) continue
    if (!world.has(hostName)) throw new Error(`${id}: overlay for unknown host "${hostName}"`)
    applyOverlay(world.host(hostName), overlay, programs)
  }
  for (const [name, original] of Object.entries(setup.clone)) {
    if (!world.has(original)) throw new Error(`${id}: cannot clone unknown host "${original}"`)
    world.add(world.host(original).clone(name))
    const overlay = setup.overlays[name]
    if (overlay) applyOverlay(world.host(name), overlay, programs)
  }

  if (setup.time !== undefined) {
    if (setup.time < world.clock.now) {
      throw new Error(`${id}: setup time is earlier than the clock already reads`)
    }
    world.clock.advance(setup.time - world.clock.now)
  }
}

/**
 * The world as it stands when a level begins: the base hosts, plus the setup
 * of every level up to and including this one. It does not depend on how
 * earlier levels were played, so every level starts from a known state.
 */
export function buildWorld(game: LoadedGame, levelIndex: number, programs: ProgramRegistry): World {
  const world = new World(game.game.start)
  for (const spec of game.hosts) world.add(buildHost(spec, { clock: world.clock, programs }))
  for (let i = 0; i <= levelIndex; i++) {
    const loaded = game.levels[i]
    if (!loaded) throw new Error(`no level at position ${i + 1}`)
    applySetup(world, loaded, programs)
  }
  return world
}

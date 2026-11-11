// Every content file, bundled into the page as text when the site is built.
// Nothing is fetched while the game runs.

import type { ContentSource } from '../engine/levels/loader.ts'

const files = import.meta.glob<string>(['./**/*.yaml', './world/files/*', './man/*'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** The game's own content, by path within this folder: `levels/L01-the-discrepancy.yaml`. */
export const contentSource: ContentSource = (path) => {
  const text = files[`./${path}`]
  if (text === undefined) throw new Error(`no such content file: ${path}`)
  // The simulated host is Unix whatever machine the files were edited on.
  return text.replace(/\r\n/g, '\n')
}

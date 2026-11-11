import { describe, expect, it } from 'vitest'
import { ENGINE_VERSION } from '../version.ts'
import { decodeSave, encodeSave, SAVE_VERSION, type Migration, type SaveData } from './save.ts'

const SAVE: SaveData = {
  completed: ['L01-first'],
  current: {
    level: 'L02-second',
    events: [
      { type: 'begin' },
      { type: 'command', line: 'ls -l "my file" | sort > /tmp/out' },
      { type: 'continue' },
      { type: 'answer', entry: 'finding', answer: { kind: 'fill', values: { name: 'alpha', count: '2' } } },
      { type: 'answer', entry: 'which', answer: { kind: 'choose', chosen: ['a', 'c'] } },
      { type: 'answer', entry: 'proof', answer: { kind: 'pin', text: '-rwsr-xr-x  1 root', source: 'terminal' } },
      { type: 'answer', entry: 'fix', answer: { kind: 'write', text: 'I removed the bit.' } },
      { type: 'move', move: { do: 'write', card: 'key' } },
      { type: 'move', move: { do: 'send', spot: 'peg' } },
      { type: 'move', move: { do: 'wait' } },
      { type: 'move', move: { do: 'fix', change: 'strip' } },
    ],
  },
}

describe('saving', () => {
  it('comes back exactly as it went in', () => {
    expect(decodeSave(encodeSave(SAVE))).toEqual(SAVE)
    const nothing: SaveData = { completed: [], current: null }
    expect(decodeSave(encodeSave(nothing))).toEqual(nothing)
  })

  it('is stamped with the save version and the build that wrote it', () => {
    expect(JSON.parse(encodeSave(SAVE))).toMatchObject({ version: SAVE_VERSION, engine: ENGINE_VERSION })
  })

  it('holds no part of the simulated world, only what the player did', () => {
    expect(Object.keys(JSON.parse(encodeSave(SAVE))).sort()).toEqual(['completed', 'current', 'engine', 'version'])
  })
})

describe('loading', () => {
  const edited = (change: (save: Record<string, unknown>) => void): string => {
    const save = JSON.parse(encodeSave(SAVE)) as Record<string, unknown>
    change(save)
    return JSON.stringify(save)
  }

  it('gives nothing when there is no save', () => {
    expect(decodeSave(null)).toBeNull()
    expect(decodeSave(undefined)).toBeNull()
    expect(decodeSave('')).toBeNull()
  })

  it('gives nothing for text that is not a save', () => {
    expect(decodeSave('not json {')).toBeNull()
    expect(decodeSave('null')).toBeNull()
    expect(decodeSave('[1, 2]')).toBeNull()
    expect(decodeSave('"a string"')).toBeNull()
    expect(decodeSave('{}')).toBeNull()
  })

  it('gives nothing for a save that is damaged', () => {
    expect(decodeSave(edited((s) => delete s['completed']))).toBeNull()
    expect(decodeSave(edited((s) => (s['completed'] = 'L01-first')))).toBeNull()
    expect(decodeSave(edited((s) => (s['current'] = { level: 'L02-second' })))).toBeNull()
    expect(decodeSave(edited((s) => (s['current'] = { level: 'x', events: [{ type: 'teleport' }] })))).toBeNull()
    expect(decodeSave(edited((s) => (s['current'] = { level: 'x', events: [{ type: 'command', line: 7 }] })))).toBeNull()
    expect(
      decodeSave(
        edited(
          (s) =>
            (s['current'] = {
              level: 'x',
              events: [{ type: 'answer', entry: 'e', answer: { kind: 'fill', values: { a: 1 } } }],
            }),
        ),
      ),
    ).toBeNull()
  })

  it('gives nothing for a save written by a newer version of the game', () => {
    expect(decodeSave(edited((s) => (s['version'] = SAVE_VERSION + 1)))).toBeNull()
    expect(decodeSave(edited((s) => (s['version'] = 'one')))).toBeNull()
    expect(decodeSave(edited((s) => (s['version'] = 1.5)))).toBeNull()
  })

  it('does not mind a save from another build of the same save version', () => {
    expect(decodeSave(edited((s) => (s['engine'] = '0.0.1')))).toEqual(SAVE)
    expect(decodeSave(edited((s) => delete s['engine']))).toEqual(SAVE)
  })
})

describe('migrating', () => {
  // An imagined earlier format: completed levels were called "done", and
  // there was no record of the level in progress.
  const old = JSON.stringify({ version: SAVE_VERSION - 1, done: ['L01-first'] })
  const upgrade: Migration = (save) => ({ completed: save['done'], current: null })

  it('brings an older save forward, one version at a time', () => {
    expect(decodeSave(old, { [SAVE_VERSION - 1]: upgrade })).toEqual({ completed: ['L01-first'], current: null })
  })

  it('gives nothing when there is no way forward from an old version', () => {
    expect(decodeSave(old)).toBeNull()
    expect(decodeSave(old, {})).toBeNull()
  })

  it('gives nothing when a migration fails or produces something that is not a save', () => {
    const throws: Migration = () => {
      throw new Error('cannot read this')
    }
    expect(decodeSave(old, { [SAVE_VERSION - 1]: throws })).toBeNull()
    expect(decodeSave(old, { [SAVE_VERSION - 1]: () => ({ completed: 'everything' }) })).toBeNull()
  })
})

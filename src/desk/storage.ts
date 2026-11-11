// Where saves live: this browser's local storage, and nowhere else. Storage
// can be unavailable (private windows, blocked site data, a full disk), so
// every use is guarded: the game must play the same without it, just without
// remembering.

import { decodeSave, encodeSave, type SaveData } from '../engine/save/save.ts'

/** The save kept under `key`, or null if there is none that can be used. */
export function loadSaved(key: string): SaveData | null {
  try {
    return decodeSave(window.localStorage.getItem(key))
  } catch {
    return null
  }
}

/** Keep a save under `key`. Returns false if this browser would not take it. */
export function store(key: string, data: SaveData): boolean {
  try {
    window.localStorage.setItem(key, encodeSave(data))
    return true
  } catch {
    return false
  }
}

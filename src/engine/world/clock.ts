/**
 * The in-game clock, in seconds. It never follows the real clock: it moves
 * only when something advances it, so the same inputs always give the same
 * world.
 */
export class Clock {
  private seconds: number
  private readonly listeners = new Set<(now: number, previous: number) => void>()

  constructor(start: number) {
    this.seconds = start
  }

  get now(): number {
    return this.seconds
  }

  /** Move time forward and tell every listener. Time never runs backwards. */
  advance(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new RangeError(`cannot advance the clock by ${seconds} seconds`)
    }
    if (seconds === 0) return
    const previous = this.seconds
    this.seconds += seconds
    for (const listener of this.listeners) listener(this.seconds, previous)
  }

  /** Call `listener` after every advance. Returns a function that stops the calls. */
  onAdvance(listener: (now: number, previous: number) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

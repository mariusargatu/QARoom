import type { Clock } from '@qaroom/determinism'

/**
 * Seeded test Clock. Pinned to a fixed instant; tests advance it explicitly.
 * This is the test-side counterpart to production `SystemClock` — the sanctioned
 * place for `new Date(...)` on the test side (lint-exempt by path).
 */
export class FakeClock implements Clock {
  #epochMs: number

  constructor(initial: string | number | Date = '2026-01-01T00:00:00.000Z') {
    this.#epochMs = initial instanceof Date ? initial.getTime() : new Date(initial).getTime()
  }

  now(): Date {
    return new Date(this.#epochMs)
  }

  /** Advance logical time by `ms` milliseconds. */
  advance(ms: number): void {
    this.#epochMs += ms
  }

  /** Pin to an absolute instant. */
  set(instant: string | number | Date): void {
    this.#epochMs = instant instanceof Date ? instant.getTime() : new Date(instant).getTime()
  }
}

import type { Clock } from '../types'

/**
 * A `Clock` pinned to a fixed instant — the replay clock (Commitment 8). A service booted in
 * snapshot-replay mode wires this from the bundle's `clock_seed`, so every `clock.now()` during
 * replay returns the captured instant and time-dependent behaviour reproduces deterministically.
 *
 * Distinct from the test-side `FakeClock` (which is advanceable): this is a production-importable
 * primitive used by real service boot, so it lives in `@qaroom/determinism`, not testing-utils.
 */
export class FixedClock implements Clock {
  readonly #epochMs: number

  constructor(instant: string | number | Date) {
    this.#epochMs = instant instanceof Date ? instant.getTime() : new Date(instant).getTime()
  }

  now(): Date {
    return new Date(this.#epochMs)
  }
}

import type { Clock } from '../types'

/**
 * The sanctioned seconds<->Date bridge. Lives under `production/` because that is the only glob
 * `eslint.config.js` exempts from the `qaroom/no-new-date` fence — services cannot write
 * `new Date(ms)`, which is exactly what used to force them into the `clock.now().setTime(...)`
 * in-place mutation idiom. These two pure functions give them a deterministic, immutable escape
 * hatch instead. Inputs stay clock-derived, so determinism (Commitment 6) holds.
 */

/** Current logical time as Unix seconds (JWT NumericDate). Pure read of the injected Clock. */
export function unixSeconds(clock: Clock): number {
  return Math.floor(clock.now().getTime() / 1000)
}

/**
 * A fresh Date at `epochMs`. Never mutates an existing instant, so it cannot alias a Clock's
 * internal Date — the immutable replacement for `clock.now(); d.setTime(epochMs)`.
 */
export function dateFromEpochMillis(epochMs: number): Date {
  return new Date(epochMs)
}

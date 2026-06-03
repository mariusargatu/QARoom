/**
 * Determinism abstractions (Commitment 6). Every service accepts injectable
 * Clock / IdGenerator / Randomness. Production wires the real implementations
 * in `./production`; tests wire seeded deterministic doubles (in @qaroom/testing-utils).
 *
 * Business logic reads ONLY these interfaces — never `new Date()`,
 * `Math.random()`, or unseeded UUID generation. Leakage is a P0 defect,
 * enforced by `eslint-plugin-qaroom`.
 */

/** Logical time. Business TTLs/expiries/timers read `now()` only. */
export interface Clock {
  now(): Date
}

/**
 * Emits prefixed ULID strings, e.g. `post_01HXYZ...`. The branded-type parsers
 * in `@qaroom/contracts` validate and brand the result at the boundary.
 */
export interface IdGenerator {
  next(prefix: string): string
}

/** Seedable pseudo-randomness. Tests seed it; production uses CSPRNG. */
export interface Randomness {
  /** Uniform float in [0, 1). */
  next(): number
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number
}

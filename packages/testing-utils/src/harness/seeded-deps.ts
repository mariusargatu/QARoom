import { FakeClock } from '../determinism/fake-clock'
import { SeededIdGenerator } from '../determinism/seeded-id-generator'
import { SeededRandomness } from '../determinism/seeded-randomness'

/** Independent seeds per source of non-determinism (all default to 1 / epoch). */
export interface SeedConfig {
  time?: string | number | Date
  ids?: number
  randomness?: number
}

export interface SeededDeps {
  clock: FakeClock
  ids: SeededIdGenerator
  randomness: SeededRandomness
}

/**
 * The seeded determinism trio a service test needs (clock, ids, randomness). This is
 * the single wiring site for the set — `setupServiceTest` routes through it and only
 * adds a pglite database. The `LamportGate` is deliberately NOT here: each app factory
 * derives its own gate from these same seeded ids (the `deps.lamport ?? new LamportGate(deps.ids)`
 * fallback), so wiring one in the harness would be a redundant second source.
 */
export function createSeededDeps(config: SeedConfig = {}): SeededDeps {
  return {
    clock: new FakeClock(config.time),
    ids: new SeededIdGenerator(config.ids ?? 1),
    randomness: new SeededRandomness(config.randomness ?? 1),
  }
}

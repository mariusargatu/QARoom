import type { Randomness } from '@qaroom/determinism'
import prand from 'pure-rand'

const UINT32 = 0x1_0000_0000

/** Seeded test Randomness backed by pure-rand's xoroshiro128+. Reproducible per seed. */
export class SeededRandomness implements Randomness {
  #rng: prand.RandomGenerator

  constructor(seed = 1) {
    this.#rng = prand.xoroshiro128plus(seed)
  }

  next(): number {
    const [value, nextRng] = prand.uniformIntDistribution(0, UINT32 - 1, this.#rng)
    this.#rng = nextRng
    return value / UINT32
  }

  int(min: number, max: number): number {
    const [value, nextRng] = prand.uniformIntDistribution(min, max, this.#rng)
    this.#rng = nextRng
    return value
  }
}

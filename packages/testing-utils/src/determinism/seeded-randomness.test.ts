import { describe, expect, it } from 'vitest'
import { SeededRandomness } from './seeded-randomness'

/**
 * SeededRandomness threads pure-rand's immutable xoroshiro state by hand, so its
 * same-seed determinism is the least self-evident of the three doubles and the only
 * one that was untested — yet it underpins Milestone 0 exit criterion 7 (reproducible
 * property/fuzz seeds). These pin the reproducibility guarantee.
 */
function sequence<T>(r: SeededRandomness, draw: (r: SeededRandomness) => T, n = 16): T[] {
  return Array.from({ length: n }, () => draw(r))
}

describe('SeededRandomness', () => {
  it('yields the same real-number sequence for the same seed', () => {
    expect(sequence(new SeededRandomness(42), (r) => r.next())).toEqual(
      sequence(new SeededRandomness(42), (r) => r.next()),
    )
  })

  it('yields the same bounded-integer sequence for the same seed', () => {
    expect(sequence(new SeededRandomness(7), (r) => r.int(0, 1_000_000))).toEqual(
      sequence(new SeededRandomness(7), (r) => r.int(0, 1_000_000)),
    )
  })

  it('yields different sequences for different seeds', () => {
    expect(sequence(new SeededRandomness(1), (r) => r.next())).not.toEqual(
      sequence(new SeededRandomness(2), (r) => r.next()),
    )
  })

  it('draws reals within the half-open unit interval', () => {
    const values = sequence(new SeededRandomness(99), (r) => r.next(), 256)
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true)
  })

  it('draws bounded integers within the requested inclusive range', () => {
    const values = sequence(new SeededRandomness(99), (r) => r.int(5, 9), 256)
    expect(values.every((v) => v >= 5 && v <= 9)).toBe(true)
  })
})

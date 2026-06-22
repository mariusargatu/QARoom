import { afterEach, describe, expect, it, vi } from 'vitest'
import { CryptoRandomness } from './crypto-randomness'

const SAMPLES = 1000

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CryptoRandomness.next', () => {
  it('returns a float in the half-open unit interval [0, 1) across many draws', () => {
    const rng = new CryptoRandomness()
    const draws = Array.from({ length: SAMPLES }, () => rng.next())
    expect(Math.min(...draws)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...draws)).toBeLessThan(1)
  })

  it('maps the maximum 32-bit word to just under 1', () => {
    const rng = new CryptoRandomness()
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((buf) => {
      ;(buf as Uint32Array)[0] = 0xff_ff_ff_ff
      return buf
    })
    const value = rng.next()
    expect(value).toBeLessThan(1)
    expect(value).toBeGreaterThan(0.999)
  })

  it('maps a zero word to exactly 0', () => {
    const rng = new CryptoRandomness()
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((buf) => {
      ;(buf as Uint32Array)[0] = 0
      return buf
    })
    expect(rng.next()).toBe(0)
  })

  it('falls back to 0 when the platform leaves the buffer unfilled', () => {
    const rng = new CryptoRandomness()
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((buf) => buf)
    // A fresh Uint32Array(1) is [0]; assert the nullish-coalescing guard yields 0.
    expect(rng.next()).toBe(0)
  })
})

describe('CryptoRandomness.int', () => {
  it('returns integers within the inclusive [min, max] range across many draws', () => {
    const rng = new CryptoRandomness()
    const draws = Array.from({ length: SAMPLES }, () => rng.int(3, 7))
    expect(draws.every(Number.isInteger)).toBe(true)
    expect(Math.min(...draws)).toBeGreaterThanOrEqual(3)
    expect(Math.max(...draws)).toBeLessThanOrEqual(7)
  })

  it('returns the single value when min equals max', () => {
    expect(new CryptoRandomness().int(5, 5)).toBe(5)
  })

  it('returns min when the underlying draw is 0', () => {
    const rng = new CryptoRandomness()
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((buf) => {
      ;(buf as Uint32Array)[0] = 0
      return buf
    })
    expect(rng.int(10, 20)).toBe(10)
  })

  it('returns max when the underlying draw is at the top of the range', () => {
    const rng = new CryptoRandomness()
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((buf) => {
      ;(buf as Uint32Array)[0] = 0xff_ff_ff_ff
      return buf
    })
    expect(rng.int(10, 20)).toBe(20)
  })
})

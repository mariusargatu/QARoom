import { FakeClock } from '@qaroom/testing-utils/determinism'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { RateLimiter } from './rate-limiter'

const FROZEN = '2026-01-01T00:00:00.000Z'

describe('rate limiter (property)', () => {
  it('never allows more than capacity requests before any refill', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 0, max: 80 }),
        (capacity, n) => {
          const limiter = new RateLimiter(new FakeClock(FROZEN), { capacity, refillPerSec: 0 })
          const outcomes = Array.from({ length: n }, () => limiter.consume('p').allowed)
          const allowed = outcomes.filter(Boolean).length
          expect(allowed).toBe(Math.min(n, capacity))
        },
      ),
    )
  })

  it('a denied request always reports a positive retry-after when the bucket refills over time', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 10 }),
        (capacity, refillPerSec) => {
          const limiter = new RateLimiter(new FakeClock(FROZEN), { capacity, refillPerSec })
          Array.from({ length: capacity }, () => limiter.consume('p'))
          const denied = limiter.consume('p')
          expect(denied.allowed).toBe(false)
          expect(denied.retryAfterSec).toBeGreaterThanOrEqual(1)
        },
      ),
    )
  })

  it('refills tokens as the injected clock advances', () => {
    const clock = new FakeClock(FROZEN)
    const limiter = new RateLimiter(clock, { capacity: 2, refillPerSec: 1 })
    limiter.consume('p')
    limiter.consume('p')
    const drained = limiter.consume('p')
    clock.advance(1000)
    const afterRefill = limiter.consume('p')
    expect(drained.allowed).toBe(false)
    expect(afterRefill.allowed).toBe(true)
  })

  it('isolates buckets per principal key', () => {
    const limiter = new RateLimiter(new FakeClock(FROZEN), { capacity: 1, refillPerSec: 0 })
    const a = limiter.consume('principal:a')
    const b = limiter.consume('principal:b')
    expect(a.allowed).toBe(true)
    expect(b.allowed).toBe(true)
  })
})

// The /system/limits route exposes remaining / secondsToFull / retryAfterSec verbatim, so each
// numeric field needs an exact assertion (the property suite above only checks booleans/invariants).
describe('rate limiter decision fields (exact values)', () => {
  it('remaining is the floor of the tokens left after each consume', () => {
    const limiter = new RateLimiter(new FakeClock(FROZEN), { capacity: 3, refillPerSec: 0 })
    expect(limiter.consume('p').remaining).toBe(2)
    expect(limiter.consume('p').remaining).toBe(1)
    expect(limiter.consume('p').remaining).toBe(0)
  })

  it('secondsToFull is ceil(token deficit / refill rate)', () => {
    const limiter = new RateLimiter(new FakeClock(FROZEN), { capacity: 10, refillPerSec: 3 })
    Array.from({ length: 10 }, () => limiter.consume('p'))
    const decision = limiter.peek('p')
    expect(decision.secondsToFull).toBe(4) // ceil(10 / 3)
    expect(decision.allowed).toBe(true) // peek never denies
    expect(decision.retryAfterSec).toBe(0) // peek is not a denied consume
  })

  it('secondsToFull and retryAfterSec are zero when refill is disabled', () => {
    const limiter = new RateLimiter(new FakeClock(FROZEN), { capacity: 1, refillPerSec: 0 })
    limiter.consume('p')
    const denied = limiter.consume('p')
    expect(denied.allowed).toBe(false)
    expect(denied.secondsToFull).toBe(0)
    expect(denied.retryAfterSec).toBe(0)
  })

  it('refill caps tokens at capacity even after a long idle period', () => {
    const clock = new FakeClock(FROZEN)
    const limiter = new RateLimiter(clock, { capacity: 2, refillPerSec: 5 })
    limiter.consume('p')
    limiter.consume('p')
    clock.advance(10_000) // far more than enough to overfill
    expect(limiter.peek('p').remaining).toBe(2) // capped, not 2 + 50
  })

  it('peek does not consume a token', () => {
    const limiter = new RateLimiter(new FakeClock(FROZEN), { capacity: 2, refillPerSec: 0 })
    limiter.peek('p')
    expect(limiter.consume('p').remaining).toBe(1)
  })
})

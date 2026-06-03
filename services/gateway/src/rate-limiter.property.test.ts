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

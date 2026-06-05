import type { Randomness } from '@qaroom/determinism'
import { describe, expect, it } from 'vitest'
import { backoffCeilingMs, nextBackoff, WEBHOOK_RETRY_POLICY } from './webhook-retry'

// Inline Randomness doubles: contracts cannot import @qaroom/testing-utils (circular dep). The
// fast-check property version of these invariants lives in services/webhooks (which has fast-check).
const fixed = (value: number): Randomness => ({ next: () => value, int: () => 0 })

describe('backoffCeilingMs', () => {
  it('grows exponentially by the multiplier until the cap', () => {
    // base 1000, multiplier 2: 1000, 2000, 4000, 8000, ...
    expect(backoffCeilingMs(1)).toBe(1_000)
    expect(backoffCeilingMs(2)).toBe(2_000)
    expect(backoffCeilingMs(3)).toBe(4_000)
    expect(backoffCeilingMs(4)).toBe(8_000)
  })

  it('never exceeds max_delay_ms once the exponential passes the cap', () => {
    // Attempt 20 would be 1000 * 2^19 ≫ 1h; the ceiling clamps to max_delay_ms.
    expect(backoffCeilingMs(20)).toBe(WEBHOOK_RETRY_POLICY.max_delay_ms)
  })

  it('is monotonic non-decreasing across attempts', () => {
    let prev = 0
    for (let attempt = 1; attempt <= WEBHOOK_RETRY_POLICY.max_attempts; attempt += 1) {
      const ceiling = backoffCeilingMs(attempt)
      expect(ceiling).toBeGreaterThanOrEqual(prev)
      prev = ceiling
    }
  })
})

describe('nextBackoff', () => {
  it('returns a delay within [0, ceiling] for every non-final attempt', () => {
    expect(nextBackoff(1, fixed(0))).toBe(0)
    expect(nextBackoff(1, fixed(0.999_999))).toBeLessThanOrEqual(backoffCeilingMs(1))
    expect(nextBackoff(3, fixed(0.5))).toBe(Math.floor(0.5 * backoffCeilingMs(3)))
  })

  it('never produces a delay greater than max_delay_ms', () => {
    for (let attempt = 1; attempt < WEBHOOK_RETRY_POLICY.max_attempts; attempt += 1) {
      expect(nextBackoff(attempt, fixed(0.999_999_999))).toBeLessThanOrEqual(
        WEBHOOK_RETRY_POLICY.max_delay_ms,
      )
    }
  })

  it('returns null exactly when the attempt budget is exhausted (dead-letter signal)', () => {
    expect(nextBackoff(WEBHOOK_RETRY_POLICY.max_attempts - 1, fixed(0.5))).not.toBeNull()
    expect(nextBackoff(WEBHOOK_RETRY_POLICY.max_attempts, fixed(0.5))).toBeNull()
    expect(nextBackoff(WEBHOOK_RETRY_POLICY.max_attempts + 5, fixed(0.5))).toBeNull()
  })
})

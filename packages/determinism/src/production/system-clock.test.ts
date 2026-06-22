import { describe, expect, it } from 'vitest'
import { SystemClock } from './system-clock'

describe('SystemClock', () => {
  it('returns a Date', () => {
    expect(new SystemClock().now()).toBeInstanceOf(Date)
  })

  it('observes a wall-clock instant that falls between the two readings bracketing it', () => {
    const before = Date.now()
    const observed = new SystemClock().now().getTime()
    const after = Date.now()
    expect(observed).toBeGreaterThanOrEqual(before)
    expect(observed).toBeLessThanOrEqual(after)
  })

  it('returns a fresh Date on each call that cannot alias a prior reading', () => {
    const clock = new SystemClock()
    const first = clock.now()
    const second = clock.now()
    expect(first).not.toBe(second)
  })
})

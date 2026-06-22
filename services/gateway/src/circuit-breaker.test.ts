import { FakeClock, SeededRandomness } from '@qaroom/testing-utils/determinism'
import { describe, expect, it } from 'vitest'
import { CircuitBreaker } from './circuit-breaker'

/** A breaker with deterministic timing: zero jitter so the cooldown is exactly `cooldownMs`. */
function breaker(clock: FakeClock) {
  return new CircuitBreaker(clock, new SeededRandomness(1), {
    threshold: 3,
    cooldownMs: 1000,
    jitterRatio: 0,
  })
}

describe('CircuitBreaker', () => {
  it('allows calls while closed', () => {
    const b = breaker(new FakeClock())
    expect(b.allow()).toBe(true)
    expect(b.open).toBe(false)
  })

  it('opens after the threshold of consecutive failures', () => {
    const b = breaker(new FakeClock())
    b.record(false)
    b.record(false)
    b.record(false)
    expect(b.open).toBe(true)
    expect(b.allow()).toBe(false)
  })

  it('stays closed when a success interrupts the failure streak', () => {
    const b = breaker(new FakeClock())
    b.record(false)
    b.record(false)
    b.record(true)
    b.record(false)
    b.record(false)
    expect(b.open).toBe(false)
    expect(b.allow()).toBe(true)
  })

  it('keeps blocking calls before the cooldown elapses', () => {
    const clock = new FakeClock()
    const b = breaker(clock)
    b.record(false)
    b.record(false)
    b.record(false)
    clock.advance(999)
    expect(b.allow()).toBe(false)
  })

  it('admits one half-open trial once the cooldown elapses', () => {
    const clock = new FakeClock()
    const b = breaker(clock)
    b.record(false)
    b.record(false)
    b.record(false)
    clock.advance(1000)
    expect(b.allow()).toBe(true)
  })

  it('closes after a successful half-open trial', () => {
    const clock = new FakeClock()
    const b = breaker(clock)
    b.record(false)
    b.record(false)
    b.record(false)
    clock.advance(1000)
    b.allow()
    b.record(true)
    expect(b.open).toBe(false)
    expect(b.allow()).toBe(true)
  })

  it('admits only one half-open trial at a time, refusing a concurrent second probe', () => {
    const clock = new FakeClock()
    const b = breaker(clock)
    b.record(false)
    b.record(false)
    b.record(false)
    clock.advance(1000)
    // First call past the cooldown takes the single half-open slot...
    expect(b.allow()).toBe(true)
    // ...a concurrent second caller (no record() yet) is refused so a sick provider isn't probed
    // by every in-flight request at once.
    expect(b.allow()).toBe(false)
  })

  it('re-opens after a failed half-open trial', () => {
    const clock = new FakeClock()
    const b = breaker(clock)
    b.record(false)
    b.record(false)
    b.record(false)
    clock.advance(1000)
    b.allow()
    b.record(false)
    expect(b.open).toBe(true)
    expect(b.allow()).toBe(false)
  })
})

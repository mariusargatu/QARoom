import { describe, expect, it } from 'vitest'
import { dateFromEpochMillis, unixSeconds } from './clock-bridge'
import { FixedClock } from './fixed-clock'

describe('unixSeconds', () => {
  it('floors clock millis to whole Unix seconds', () => {
    const clock = new FixedClock(1_700_000_000_500)
    expect(unixSeconds(clock)).toBe(1_700_000_000)
  })
})

describe('dateFromEpochMillis', () => {
  it('returns a Date at the given epoch', () => {
    expect(dateFromEpochMillis(1_700_000_000_000).getTime()).toBe(1_700_000_000_000)
  })

  it('returns a fresh Date that cannot alias the clock instant', () => {
    const clock = new FixedClock(1_700_000_000_000)
    const derived = dateFromEpochMillis(clock.now().getTime())
    derived.setTime(0)
    expect(clock.now().getTime()).toBe(1_700_000_000_000)
  })
})

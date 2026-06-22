import { describe, expect, it } from 'vitest'
import { FixedClock } from './fixed-clock'

const INSTANT_MS = 1_700_000_000_000
const INSTANT_ISO = '2023-11-14T22:13:20.000Z'

describe('FixedClock', () => {
  it('pins to an instant given as epoch milliseconds', () => {
    expect(new FixedClock(INSTANT_MS).now().getTime()).toBe(INSTANT_MS)
  })

  it('pins to an instant given as an ISO string', () => {
    expect(new FixedClock(INSTANT_ISO).now().getTime()).toBe(INSTANT_MS)
  })

  it('pins to an instant given as a Date (the instanceof branch)', () => {
    expect(new FixedClock(new Date(INSTANT_MS)).now().getTime()).toBe(INSTANT_MS)
  })

  it('returns the same instant on every call', () => {
    const clock = new FixedClock(INSTANT_MS)
    expect(clock.now().getTime()).toBe(clock.now().getTime())
  })

  it('returns a fresh Date each call so mutating one reading cannot move the clock', () => {
    const clock = new FixedClock(INSTANT_MS)
    const first = clock.now()
    first.setTime(0)
    expect(clock.now().getTime()).toBe(INSTANT_MS)
  })

  it('does not capture the passed-in Date by reference', () => {
    const source = new Date(INSTANT_MS)
    const clock = new FixedClock(source)
    source.setTime(0)
    expect(clock.now().getTime()).toBe(INSTANT_MS)
  })
})

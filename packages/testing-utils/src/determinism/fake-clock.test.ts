import { describe, expect, it } from 'vitest'
import { FakeClock } from './fake-clock'

describe('FakeClock', () => {
  it('starts pinned to the instant it was constructed with', () => {
    const clock = new FakeClock('2026-01-01T00:00:00.000Z')
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })

  it('advances logical time forward by the requested milliseconds', () => {
    const clock = new FakeClock('2026-01-01T00:00:00.000Z')
    const start = clock.now().getTime()
    clock.advance(1500)
    expect(clock.now().getTime()).toBe(start + 1500)
  })

  it('defaults to the start-of-2026 instant when constructed with no argument', () => {
    // Surfaced by the harness mutation lane (ADR-0031): the default-instant literal was never
    // exercised — every existing test passed an explicit instant, so the default could silently drift.
    expect(new FakeClock().now().toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })

  it('accepts a Date instance and pins to its instant', () => {
    // Surfaced by the harness mutation lane: the constructor's `instanceof Date` branch was uncovered.
    expect(new FakeClock(new Date('2026-06-19T08:00:00.000Z')).now().toISOString()).toBe(
      '2026-06-19T08:00:00.000Z',
    )
  })

  it('re-pinning to an absolute string instant moves logical time to that instant', () => {
    // Surfaced by the harness mutation lane: the entire `set()` body was uncovered — a no-op `set()`
    // would have passed every test, so a regression that silently stopped re-pinning was invisible.
    const clock = new FakeClock('2026-01-01T00:00:00.000Z')
    clock.set('2027-03-04T05:06:07.000Z')
    expect(clock.now().toISOString()).toBe('2027-03-04T05:06:07.000Z')
  })

  it('re-pinning accepts a Date instance, not only a string', () => {
    // Covers the `instanceof Date` branch inside set(), the mirror of the constructor branch.
    const clock = new FakeClock('2026-01-01T00:00:00.000Z')
    clock.set(new Date('2028-12-31T23:59:59.000Z'))
    expect(clock.now().toISOString()).toBe('2028-12-31T23:59:59.000Z')
  })
})

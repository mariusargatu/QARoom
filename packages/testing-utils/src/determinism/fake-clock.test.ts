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
})

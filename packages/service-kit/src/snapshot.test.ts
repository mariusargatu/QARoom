import { afterEach, describe, expect, it } from 'vitest'
import { resolveBootDeps } from './snapshot'

/**
 * Pins the snapshot-replay env gate (Commitment 8). The contract is `SNAPSHOT_REPLAY=1` enables
 * replay and nothing else does — guarding the string-truthiness trap where `=0`/`=false` would
 * otherwise boot a "live" service into replay mode (frozen clock, outbox never drained).
 */
describe('resolveBootDeps', () => {
  afterEach(() => {
    delete process.env.SNAPSHOT_REPLAY
    delete process.env.SNAPSHOT_CLOCK_SEED
  })

  it('boots production deps when SNAPSHOT_REPLAY is unset', () => {
    expect(resolveBootDeps().replaying).toBe(false)
  })

  it('enables replay for the exact value "1"', () => {
    process.env.SNAPSHOT_REPLAY = '1'
    expect(resolveBootDeps().replaying).toBe(true)
  })

  it('treats SNAPSHOT_REPLAY=0 as off (no string-truthiness trap)', () => {
    process.env.SNAPSHOT_REPLAY = '0'
    expect(resolveBootDeps().replaying).toBe(false)
  })

  it('treats SNAPSHOT_REPLAY=false as off', () => {
    process.env.SNAPSHOT_REPLAY = 'false'
    expect(resolveBootDeps().replaying).toBe(false)
  })

  it('pins the replay clock to the default seed', () => {
    process.env.SNAPSHOT_REPLAY = '1'
    expect(resolveBootDeps().deps.clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })

  it('pins the replay clock to SNAPSHOT_CLOCK_SEED when provided', () => {
    process.env.SNAPSHOT_REPLAY = '1'
    process.env.SNAPSHOT_CLOCK_SEED = '2026-06-04T12:00:00.000Z'
    expect(resolveBootDeps().deps.clock.now().toISOString()).toBe('2026-06-04T12:00:00.000Z')
  })
})

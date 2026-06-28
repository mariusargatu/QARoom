import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type ErasureWorld, footprints, runErasure, setupErasureWorld } from './world'

/**
 * The GDPR cross-service erasure saga (T14, ADR-0036), driven END-TO-END in ONE process: identity
 * (orchestrator + outbox producer) → relay → content + donations consumers, with the real saga
 * machine tracking per-service completion. The `user-erased-everywhere` claim gate lives here.
 *
 * `CONTENT_BUG_SKIP_ERASURE` (prove --break) arms content's handler to ack WITHOUT deleting, so
 * content still returns the user: the property below reds and the saga reaches `Incomplete`.
 */
describe('cross-service erasure saga', () => {
  let world: ErasureWorld

  beforeEach(async () => {
    world = await setupErasureWorld()
  })

  afterEach(async () => {
    await world.close()
  })

  it('no service returns an erased user once the saga settles', async () => {
    await runErasure(world)
    const report = await footprints(world)
    expect(report.identityUser).toBe(false)
    expect(report.content).toBe(0)
    expect(report.donations).toBe(0)
  })

  it('reaches Erased and reports every participant confirmed', async () => {
    const result = await runErasure(world)
    expect(result.finalState).toBe('Erased')
    expect(result.complete).toBe(true)
    expect(result.perService.map((p) => [p.service, p.confirmed])).toEqual([
      ['content', true],
      ['donations', true],
    ])
  })

  it('erases only the target user — a second user’s data survives the cascade', async () => {
    const before = await footprints(world)
    expect(before.otherContent).toBeGreaterThan(0)
    await runErasure(world)
    const after = await footprints(world)
    expect(after.otherContent).toBe(before.otherContent)
  })

  it('is idempotent under redelivery: a re-delivered erasure event does not double-effect', async () => {
    // First pass leaves content's events un-acked, so the broker re-delivers them.
    const first = await runErasure(world, { leaveContentUnacked: true })
    expect(first.complete).toBe(true)
    const afterFirst = await footprints(world)
    expect(afterFirst.content).toBe(0)

    // The same events are still pending (un-acked) — re-drive the saga. `processEvent` dedups on the
    // event id, so the redelivery is a no-op and the user stays erased (no error, no resurrection).
    const second = await runErasure(world, { leaveContentUnacked: false })
    expect(second.complete).toBe(true)
    const afterSecond = await footprints(world)
    expect(afterSecond.content).toBe(0)
    expect(afterSecond.donations).toBe(0)
  })
})

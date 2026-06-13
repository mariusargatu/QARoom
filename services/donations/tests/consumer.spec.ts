import { processEvent } from '@qaroom/messaging'
import { describe, expect, it } from 'vitest'
import { FLAG_SUBSCRIPTION, flagStateChangedHandler } from '../src/consumer'
import type { DonationsDb } from '../src/db/client'
import { isDonationsEnabled } from '../src/repository'
import { SAMPLE, setupDonationsTest } from './harness'

const flagEvent = (toState: string, enabled: boolean) => ({
  event_id: 'evt_00000000000000000000000000',
  community_id: SAMPLE.communityA,
  flag_key: 'donations',
  from_state: 'Canary',
  to_state: toState,
  rollout_event: 'RolloutCompleted',
  enabled,
  occurred_at: '2026-06-04T00:00:00.000Z',
})

describe('flag-state consumer projection', () => {
  it('projects an enabling flag.state.changed event into the gating cache', async () => {
    const ctx = await setupDonationsTest()
    await processEvent(
      ctx.db,
      FLAG_SUBSCRIPTION,
      {
        eventId: 'evt_00000000000000000000000000',
        communityId: SAMPLE.communityA,
        payload: flagEvent('Enabled', true),
      },
      flagStateChangedHandler(ctx.clock),
      ctx.clock,
    )
    const enabled = await isDonationsEnabled(ctx.db as unknown as DonationsDb, SAMPLE.communityA)
    await ctx.close()
    expect(enabled).toBe(true)
  })

  it('skips a duplicate delivery (dedup) without changing the cache', async () => {
    const ctx = await setupDonationsTest()
    const delivered = {
      eventId: 'evt_00000000000000000000000000',
      communityId: SAMPLE.communityA,
      payload: flagEvent('Enabled', true),
    }
    const handler = flagStateChangedHandler(ctx.clock)
    const first = await processEvent(ctx.db, FLAG_SUBSCRIPTION, delivered, handler, ctx.clock)
    const second = await processEvent(ctx.db, FLAG_SUBSCRIPTION, delivered, handler, ctx.clock)
    const enabled = await isDonationsEnabled(ctx.db as unknown as DonationsDb, SAMPLE.communityA)
    await ctx.close()
    expect(first.skipped).toBe(false)
    expect(second.skipped).toBe(true)
    expect(enabled).toBe(true)
  })
})

/**
 * Resilient-consume semantics (the webhooks fan-out template, now driving this consumer via
 * `runResilientConsume`): a handler failure must surface (so the loop's `settle` naks the
 * message) WITHOUT marking the event processed or mutating the cache — JetStream redelivery
 * then re-runs the effect instead of dropping the event. The loop-survival half (a throw is
 * settled and the loop continues) is owned by `runResilientConsume`'s own tests in
 * `@qaroom/messaging`.
 */
describe('flag-state consumer failure semantics (at-least-once + dedup)', () => {
  it('rolls back a failed delivery: handler throws, cache unchanged', async () => {
    const ctx = await setupDonationsTest()
    const handler = flagStateChangedHandler(ctx.clock)
    await expect(
      processEvent(
        ctx.db,
        FLAG_SUBSCRIPTION,
        {
          eventId: 'evt_00000000000000000000000001',
          communityId: SAMPLE.communityA,
          payload: { not: 'a flag event' },
        },
        handler,
        ctx.clock,
      ),
    ).rejects.toThrow()
    const enabled = await isDonationsEnabled(ctx.db as unknown as DonationsDb, SAMPLE.communityA)
    await ctx.close()
    expect(enabled).toBe(false)
  })

  it('does not mark a failed delivery processed: the nak-driven redelivery re-runs the effect', async () => {
    const ctx = await setupDonationsTest()
    const handler = flagStateChangedHandler(ctx.clock)
    const delivered = {
      eventId: 'evt_00000000000000000000000002',
      communityId: SAMPLE.communityA,
    }
    await expect(
      processEvent(
        ctx.db,
        FLAG_SUBSCRIPTION,
        { ...delivered, payload: { not: 'a flag event' } },
        handler,
        ctx.clock,
      ),
    ).rejects.toThrow()
    const redelivery = await processEvent(
      ctx.db,
      FLAG_SUBSCRIPTION,
      { ...delivered, payload: flagEvent('Enabled', true) },
      handler,
      ctx.clock,
    )
    const enabled = await isDonationsEnabled(ctx.db as unknown as DonationsDb, SAMPLE.communityA)
    await ctx.close()
    expect(redelivery.skipped).toBe(false)
    expect(enabled).toBe(true)
  })
})

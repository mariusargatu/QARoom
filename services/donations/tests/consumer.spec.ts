import { processEvent } from '@qaroom/messaging'
import { describe, expect, it } from 'vitest'
import { flagStateChangedHandler } from '../src/consumer'
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
      'donations.on-flag-state',
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
    const first = await processEvent(
      ctx.db,
      'donations.on-flag-state',
      delivered,
      handler,
      ctx.clock,
    )
    const second = await processEvent(
      ctx.db,
      'donations.on-flag-state',
      delivered,
      handler,
      ctx.clock,
    )
    const enabled = await isDonationsEnabled(ctx.db as unknown as DonationsDb, SAMPLE.communityA)
    await ctx.close()
    expect(first.skipped).toBe(false)
    expect(second.skipped).toBe(true)
    expect(enabled).toBe(true)
  })
})

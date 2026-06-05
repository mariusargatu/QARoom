import { rowsOf } from '@qaroom/messaging'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { fanoutHandler } from '../src/consumer'
import { nextKey, SAMPLE, seedSubscription, setupWebhooksTest } from './harness'

type Ctx = Awaited<ReturnType<typeof setupWebhooksTest>>

async function deliverySubscriptionIds(ctx: Ctx): Promise<string[]> {
  const rows = rowsOf<{ subscription_id: string }>(
    await ctx.db.execute(
      sql`SELECT subscription_id FROM webhook_deliveries ORDER BY subscription_id`,
    ),
  )
  return rows.map((r) => r.subscription_id)
}

/**
 * Unit test for the fan-out effect (no broker): for one consumed event, insert a Pending delivery
 * for every ACTIVE subscription in the event's community whose event_types include the event type.
 */
describe('fanoutHandler', () => {
  it('inserts a delivery only for active subscriptions matching the event type', async () => {
    const ctx = await setupWebhooksTest()
    const matching = await seedSubscription(ctx, { eventTypes: ['post.created'] })
    await seedSubscription(ctx, { eventTypes: ['vote.cast'] }) // active but wrong event type
    const paused = await seedSubscription(ctx, { eventTypes: ['post.created'] })
    await ctx.request.post(
      `/api/communities/${SAMPLE.communityA}/webhook-subscriptions/${paused.id}/pause`,
      {},
      { 'idempotency-key': nextKey() },
    )

    const eventId = ctx.ids.next('evt')
    const handler = fanoutHandler(
      { ids: ctx.ids, clock: ctx.clock },
      { eventType: 'post.created', communityId: SAMPLE.communityA, eventId },
    )
    await handler(ctx.db, { event_id: eventId, community_id: SAMPLE.communityA })

    expect(await deliverySubscriptionIds(ctx)).toEqual([matching.id])
    await ctx.close()
  })

  it('is idempotent per (subscription, event): a re-run with the same event inserts no duplicate', async () => {
    const ctx = await setupWebhooksTest()
    const sub = await seedSubscription(ctx, { eventTypes: ['post.created'] })
    const eventId = ctx.ids.next('evt')
    const handler = fanoutHandler(
      { ids: ctx.ids, clock: ctx.clock },
      { eventType: 'post.created', communityId: SAMPLE.communityA, eventId },
    )
    await handler(ctx.db, { event_id: eventId, community_id: SAMPLE.communityA })
    await handler(ctx.db, { event_id: eventId, community_id: SAMPLE.communityA })

    expect(await deliverySubscriptionIds(ctx)).toEqual([sub.id])
    await ctx.close()
  })

  it('does not deliver an event to another community’s subscriptions', async () => {
    const ctx = await setupWebhooksTest()
    await seedSubscription(ctx, { communityId: SAMPLE.communityB, eventTypes: ['post.created'] })
    const eventId = ctx.ids.next('evt')
    const handler = fanoutHandler(
      { ids: ctx.ids, clock: ctx.clock },
      { eventType: 'post.created', communityId: SAMPLE.communityA, eventId },
    )
    await handler(ctx.db, { event_id: eventId, community_id: SAMPLE.communityA })

    expect(await deliverySubscriptionIds(ctx)).toEqual([])
    await ctx.close()
  })
})

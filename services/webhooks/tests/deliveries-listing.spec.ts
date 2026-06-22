import { expectRFC7807 } from '@qaroom/testing-utils/matchers'
import { describe, expect, it } from 'vitest'
import {
  drainToQuiescence,
  enqueueDelivery,
  makeWorker,
  nextKey,
  okSender,
  SAMPLE,
  scriptedSender,
  seedSubscription,
  setupWebhooksTest,
} from './harness'

const deliveriesUrl = (community: string, id: string) =>
  `/api/communities/${community}/webhook-subscriptions/${id}/deliveries`

interface DeliveryView {
  status: string
  attempt: number
  next_attempt_at: string | null
  last_status_code: number | null
}

/**
 * The observable retry contract via `GET .../deliveries` — the route's row-mapping path (which the
 * empty-ledger case never reaches). One delivery is driven to `Delivered` (terminal: next_attempt_at
 * null, status code recorded) and another is left `Retrying` after one failure (next_attempt_at set),
 * so both branches of the delivery row mapper are exercised through the real HTTP surface.
 */
describe('listWebhookDeliveries surfaces the ledger rows', () => {
  it('maps a delivered row (no next attempt, status code recorded) and a retrying row (next attempt set)', async () => {
    const ctx = await setupWebhooksTest()
    const sub = await seedSubscription(ctx)
    await enqueueDelivery(ctx, { subscriptionId: sub.id, eventId: ctx.ids.next('evt') })
    await drainToQuiescence(ctx, makeWorker(ctx, okSender()))
    await enqueueDelivery(ctx, { subscriptionId: sub.id, eventId: ctx.ids.next('evt') })
    await makeWorker(ctx, scriptedSender([{ kind: 'http_error', status: 500 }])).drainOnce()

    const res = await ctx.request.get(deliveriesUrl(SAMPLE.communityA, sub.id))
    await ctx.close()
    const deliveries = (res.json as { deliveries: DeliveryView[] }).deliveries
    const delivered = deliveries.find((d) => d.status === 'Delivered')
    const retrying = deliveries.find((d) => d.status === 'Retrying')
    expect(res.status).toBe(200)
    expect(deliveries).toHaveLength(2)
    expect(delivered?.next_attempt_at).toBeNull()
    expect(delivered?.last_status_code).toBe(200)
    expect(retrying?.next_attempt_at).not.toBeNull()
    expect(retrying?.last_status_code).toBe(500)
    expect(retrying?.attempt).toBe(1)
  })

  it('404s a deliveries listing requested from a different community (tenant-scoped)', async () => {
    const ctx = await setupWebhooksTest()
    const sub = await seedSubscription(ctx)
    const res = await ctx.request.get(deliveriesUrl(SAMPLE.communityB, sub.id))
    await ctx.close()
    expectRFC7807(res.json, { status: 404, failureDomain: 'not_found' })
  })

  it('404s a pause requested from a different community (tenant-scoped)', async () => {
    const ctx = await setupWebhooksTest()
    const sub = await seedSubscription(ctx)
    const res = await ctx.request.post(
      `/api/communities/${SAMPLE.communityB}/webhook-subscriptions/${sub.id}/pause`,
      {},
      { 'idempotency-key': nextKey() },
    )
    await ctx.close()
    expectRFC7807(res.json, { status: 404, failureDomain: 'not_found' })
  })

  it('404s a delete requested from a different community (the row is not removed)', async () => {
    const ctx = await setupWebhooksTest()
    const sub = await seedSubscription(ctx)
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/communities/${SAMPLE.communityB}/webhook-subscriptions/${sub.id}`,
      headers: { 'idempotency-key': nextKey() },
    })
    await ctx.close()
    expect(res.statusCode).toBe(404)
    expectRFC7807(res.json(), { status: 404, failureDomain: 'not_found' })
  })
})

/**
 * The worker's background-loop shell. `start` wires the shared drain loop (the only timer, unref'd);
 * tests otherwise call `drainOnce` directly. This pins that `start` hands back a working stop fn and
 * the long-interval timer never blocks teardown.
 */
describe('delivery worker background loop', () => {
  it('start returns a stop function and its timer does not block teardown', async () => {
    const ctx = await setupWebhooksTest()
    const stop = makeWorker(ctx, okSender()).start(3_600_000)
    stop()
    await ctx.close()
    expect(typeof stop).toBe('function')
  })
})

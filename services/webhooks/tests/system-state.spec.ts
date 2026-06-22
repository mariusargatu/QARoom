import { describe, expect, it } from 'vitest'
import {
  drainToQuiescence,
  enqueueDelivery,
  makeWorker,
  okSender,
  scriptedSender,
  seedSubscription,
  setupWebhooksTest,
} from './harness'

/**
 * The `/system/state` model surface (Commitment: state is reported, never invented). It folds the
 * repository's `countSubscriptions` + `countDeliveriesByStatus` into the service-kit state envelope,
 * so this is the in-process exercise of both aggregate reads and the `buildApp` `models` callback.
 */
describe('webhooks model state surfaced through /system/state', () => {
  it('reports zero subscriptions and zero deliveries on a fresh service', async () => {
    const ctx = await setupWebhooksTest()
    const state = await ctx.request.get('/system/state')
    await ctx.close()
    const body = state.json as {
      service: string
      models: { subscriptions: { count: number }; deliveries: Record<string, number> }
    }
    expect(state.status).toBe(200)
    expect(body.service).toBe('webhooks')
    expect(body.models.subscriptions.count).toBe(0)
    expect(body.models.deliveries.Delivered).toBe(0)
    expect(body.models.deliveries.DeadLettered).toBe(0)
  })

  it('counts the subscription and buckets a delivered event under Delivered', async () => {
    const ctx = await setupWebhooksTest()
    const sub = await seedSubscription(ctx)
    await enqueueDelivery(ctx, { subscriptionId: sub.id })
    await drainToQuiescence(ctx, makeWorker(ctx, okSender()))
    const state = await ctx.request.get('/system/state')
    await ctx.close()
    const body = state.json as {
      models: { subscriptions: { count: number }; deliveries: Record<string, number> }
    }
    expect(body.models.subscriptions.count).toBe(1)
    expect(body.models.deliveries.Delivered).toBe(1)
  })

  it('buckets a single failed attempt under Retrying before the budget is exhausted', async () => {
    const ctx = await setupWebhooksTest()
    const sub = await seedSubscription(ctx)
    await enqueueDelivery(ctx, { subscriptionId: sub.id })
    await makeWorker(ctx, scriptedSender([{ kind: 'http_error', status: 500 }])).drainOnce()
    const state = await ctx.request.get('/system/state')
    await ctx.close()
    const body = state.json as { models: { deliveries: Record<string, number> } }
    expect(body.models.deliveries.Retrying).toBe(1)
    expect(body.models.deliveries.Delivered).toBe(0)
  })
})

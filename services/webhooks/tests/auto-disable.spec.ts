import { rowsOf } from '@qaroom/messaging'
import { sql } from 'drizzle-orm'
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

type Ctx = Awaited<ReturnType<typeof setupWebhooksTest>>

async function subscription(
  ctx: Ctx,
  id: string,
): Promise<{ status: string; consecutive_dead_letters: number }> {
  const rows = rowsOf<{ status: string; consecutive_dead_letters: number }>(
    await ctx.db.execute(
      sql`SELECT status, consecutive_dead_letters FROM webhook_subscriptions WHERE id = ${id}`,
    ),
  )
  return rows[0] ?? { status: 'missing', consecutive_dead_letters: -1 }
}

const FAIL = { kind: 'http_error', status: 500 } as const

describe('subscription auto-quarantine on repeated dead-letters', () => {
  it('disables a subscription after the consecutive dead-letter threshold', async () => {
    const ctx = await setupWebhooksTest()
    const sub = await seedSubscription(ctx)
    // 10 deliveries that all fail → 10 consecutive dead-letters → Disabled (threshold is 10).
    for (let i = 0; i < 10; i += 1) await enqueueDelivery(ctx, { subscriptionId: sub.id })
    await drainToQuiescence(ctx, makeWorker(ctx, scriptedSender([FAIL])))

    const after = await subscription(ctx, sub.id)
    await ctx.close()
    expect(after.consecutive_dead_letters).toBeGreaterThanOrEqual(10)
    expect(after.status).toBe('Disabled')
  })

  it('resets the streak on a successful delivery', async () => {
    const ctx = await setupWebhooksTest()
    const sub = await seedSubscription(ctx)
    await enqueueDelivery(ctx, { subscriptionId: sub.id })
    await drainToQuiescence(ctx, makeWorker(ctx, scriptedSender([FAIL])))
    expect((await subscription(ctx, sub.id)).consecutive_dead_letters).toBe(1)

    await enqueueDelivery(ctx, { subscriptionId: sub.id })
    await drainToQuiescence(ctx, makeWorker(ctx, okSender()))
    const after = await subscription(ctx, sub.id)
    await ctx.close()
    expect(after.consecutive_dead_letters).toBe(0)
    expect(after.status).toBe('Active')
  })
})

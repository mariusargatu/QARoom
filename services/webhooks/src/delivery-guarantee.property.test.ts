import { test } from '@fast-check/vitest'
import { WEBHOOK_RETRY_POLICY } from '@qaroom/contracts'
import { rowsOf } from '@qaroom/messaging'
import { withResource } from '@qaroom/testing-utils/harness'
import { sql } from 'drizzle-orm'
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import {
  drainToQuiescence,
  enqueueDelivery,
  makeWorker,
  type RecordingSender,
  scriptedSender,
  seedSubscription,
  setupWebhooksTest,
} from '../tests/harness'
import type { SendResult } from './sender'

const FAIL: SendResult = { kind: 'http_error', status: 500 }
const OK: SendResult = { kind: 'success', status: 200 }

// A spread of non-2xx codes a receiver can return — including the "looks final" 410 (Gone) and the
// "slow down" 429, which a naive classifier might wrongly treat as terminal Delivered.
const HTTP_ERROR_STATUSES = [400, 404, 410, 429, 500, 503] as const

async function deliveryStatus(ctx: Awaited<ReturnType<typeof setupWebhooksTest>>): Promise<string> {
  const rows = rowsOf<{ status: string }>(
    await ctx.db.execute(sql`SELECT status FROM webhook_deliveries LIMIT 1`),
  )
  return rows[0]?.status ?? 'missing'
}

async function lastStatusCode(
  ctx: Awaited<ReturnType<typeof setupWebhooksTest>>,
): Promise<number | null> {
  const rows = rowsOf<{ last_status_code: number | null }>(
    await ctx.db.execute(sql`SELECT last_status_code FROM webhook_deliveries LIMIT 1`),
  )
  return rows[0]?.last_status_code ?? null
}

/**
 * The at-least-once delivery guarantee. Over generated receiver-failure sequences, every event
 * reaches a terminal state (Delivered or DeadLettered) — never silently lost — and the final
 * status is consistent with what the receiver actually returned.
 */
describe('at-least-once delivery guarantee', () => {
  test.prop([fc.integer({ min: 0, max: 12 }), fc.constantFrom(...HTTP_ERROR_STATUSES)], {
    numRuns: 25,
  })(
    'every delivery reaches a terminal state and Delivered implies the receiver returned 2xx',
    (failuresBeforeSuccess, failStatus) =>
      withResource(
        () => setupWebhooksTest(),
        async (ctx) => {
          const sub = await seedSubscription(ctx)
          await enqueueDelivery(ctx, { subscriptionId: sub.id })
          const fail: SendResult = { kind: 'http_error', status: failStatus }
          const sender: RecordingSender = scriptedSender([
            ...Array.from({ length: failuresBeforeSuccess }, () => fail),
            OK,
          ])
          const worker = makeWorker(ctx, sender)
          await drainToQuiescence(ctx, worker)

          const status = await deliveryStatus(ctx)
          const code = await lastStatusCode(ctx)
          const calls = sender.calls.length

          // A delivery is never stuck mid-flight.
          expect(['Delivered', 'DeadLettered']).toContain(status)
          // Within budget → delivered after exactly K+1 POSTs; else dead-lettered after max_attempts.
          const withinBudget = failuresBeforeSuccess < WEBHOOK_RETRY_POLICY.max_attempts
          expect(status).toBe(withinBudget ? 'Delivered' : 'DeadLettered')
          expect(calls).toBe(
            withinBudget ? failuresBeforeSuccess + 1 : WEBHOOK_RETRY_POLICY.max_attempts,
          )
          // Delivered implies the persisted last_status_code is the 2xx the receiver actually
          // returned — a non-2xx error code (e.g. 410/429) wrongly marked Delivered fails here.
          // A DeadLettered delivery records the last failing code instead.
          expect(code).toBe(withinBudget ? OK.status : failStatus)
        },
      ),
  )

  it('a receiver that recovers after a transient outage still gets delivered', async () => {
    const ctx = await setupWebhooksTest()
    const sub = await seedSubscription(ctx)
    await enqueueDelivery(ctx, { subscriptionId: sub.id })
    const sender = scriptedSender([{ kind: 'timeout' }, { kind: 'network_error' }, OK])
    const worker = makeWorker(ctx, sender)
    await drainToQuiescence(ctx, worker)
    expect(await deliveryStatus(ctx)).toBe('Delivered')
    expect(sender.calls.length).toBe(3)
    await ctx.close()
  })
})

// Deliberate-bug demo: CHAOS_WEBHOOK_DROP_ON_FAIL marks a FAILED send as Delivered, silently
// dropping the event. The guarantee then breaks: the delivery is "Delivered" after a single
// failing POST, never actually reaching the receiver.
describe('CHAOS_WEBHOOK_DROP_ON_FAIL deliberate-bug demo', () => {
  afterEach(() => {
    delete process.env.CHAOS_WEBHOOK_DROP_ON_FAIL
  })

  it('drops a failed delivery instead of retrying (the at-least-once guarantee is violated)', async () => {
    process.env.CHAOS_WEBHOOK_DROP_ON_FAIL = '1'
    const ctx = await setupWebhooksTest()
    const sub = await seedSubscription(ctx)
    await enqueueDelivery(ctx, { subscriptionId: sub.id })
    // The receiver would succeed on the 2nd attempt — but the bug never retries.
    const sender = scriptedSender([FAIL, OK])
    const worker = makeWorker(ctx, sender)
    await drainToQuiescence(ctx, worker)

    // Marked Delivered after a single FAILING POST — the event never reached the receiver.
    expect(await deliveryStatus(ctx)).toBe('Delivered')
    expect(sender.calls.length).toBe(1)
    await ctx.close()
  })
})

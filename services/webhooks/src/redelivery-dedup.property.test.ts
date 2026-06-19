import { test } from '@fast-check/vitest'
import { WEBHOOK_DELIVERY_ID_HEADER } from '@qaroom/contracts'
import { withResource } from '@qaroom/testing-utils/harness'
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import type { SendResult } from '../src/sender'
import {
  drainToQuiescence,
  enqueueDelivery,
  makeWorker,
  type RecordingSender,
  scriptedSender,
  seedSubscription,
  setupWebhooksTest,
} from '../tests/harness'

const TIMEOUT: SendResult = { kind: 'timeout' }
const OK: SendResult = { kind: 'success', status: 200 }

/** Distinct X-QARoom-Delivery-Id values a receiver would dedupe on across all POSTs it received. */
function distinctDeliveryIds(sender: RecordingSender): number {
  return new Set(sender.calls.map((c) => c.headers[WEBHOOK_DELIVERY_ID_HEADER])).size
}

/**
 * Receiver idempotency. At-least-once means a delivery may be POSTed more than once (e.g. the
 * receiver processed it but its response was lost to a timeout). Every redelivery carries the
 * SAME stable `X-QARoom-Delivery-Id`, so a receiver deduping on that id applies the effect exactly
 * once even though it gets N≥1 POSTs.
 */
describe('receiver idempotency via a stable delivery id', () => {
  test.prop([fc.integer({ min: 1, max: 6 })], { numRuns: 15 })(
    'redeliveries carry one stable delivery id, so a deduping receiver applies the effect once',
    (lostResponses) =>
      withResource(
        () => setupWebhooksTest(),
        async (ctx) => {
          const sub = await seedSubscription(ctx)
          await enqueueDelivery(ctx, { subscriptionId: sub.id })
          // The receiver "processes" each POST but its response is lost `lostResponses` times,
          // then finally acknowledges — so the worker POSTs `lostResponses + 1` times.
          const sender = scriptedSender([
            ...Array.from({ length: lostResponses }, () => TIMEOUT),
            OK,
          ])
          const worker = makeWorker(ctx, sender)
          await drainToQuiescence(ctx, worker)

          const posts = sender.calls.length
          const distinct = distinctDeliveryIds(sender)

          expect(posts).toBe(lostResponses + 1) // at-least-once: more than one POST
          expect(distinct).toBe(1) // exactly-once effect: one delivery id to dedupe on
        },
      ),
  )
})

// Deliberate-bug demo: CHAOS_WEBHOOK_UNSTABLE_DELIVERY_ID mints a fresh id per attempt, so a
// deduping receiver sees each redelivery as new → double-applies the effect.
describe('CHAOS_WEBHOOK_UNSTABLE_DELIVERY_ID deliberate-bug demo', () => {
  afterEach(() => {
    delete process.env.CHAOS_WEBHOOK_UNSTABLE_DELIVERY_ID
  })

  it('regenerating the delivery id per attempt breaks receiver dedup (distinct ids = POST count)', async () => {
    process.env.CHAOS_WEBHOOK_UNSTABLE_DELIVERY_ID = '1'
    const ctx = await setupWebhooksTest()
    const sub = await seedSubscription(ctx)
    await enqueueDelivery(ctx, { subscriptionId: sub.id })
    const sender = scriptedSender([TIMEOUT, TIMEOUT, OK])
    const worker = makeWorker(ctx, sender)
    await drainToQuiescence(ctx, worker)

    expect(sender.calls.length).toBe(3)
    expect(distinctDeliveryIds(sender)).toBe(3) // a deduping receiver would apply the effect 3×
    await ctx.close()
  })
})

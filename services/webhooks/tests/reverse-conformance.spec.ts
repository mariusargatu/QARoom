import { type WebhookDeliveryTransitionRecord, webhookDeliveryMachine } from '@qaroom/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import {
  drainToQuiescence,
  enqueueDelivery,
  makeWorker,
  okSender,
  seedSubscription,
  setupWebhooksTest,
} from './harness'

/**
 * Reverse-conformance (ADR-0012, ADR-0019), unit-level. Every `xstate.transition` the worker emits
 * must be a legal edge of the hand-authored delivery machine — the same check Tracetest runs against
 * spans in-cluster, here against a recording sink so it gates on every PR with no broker.
 */
function isLegalEdge(t: WebhookDeliveryTransitionRecord): boolean {
  const states = (webhookDeliveryMachine.config.states ?? {}) as Record<
    string,
    { on?: Record<string, { target?: string }> }
  >
  return states[t.from]?.on?.[t.event]?.target === t.to
}

function recordingSink() {
  const records: WebhookDeliveryTransitionRecord[] = []
  return { records, record: (t: WebhookDeliveryTransitionRecord) => records.push(t) }
}

describe('webhook delivery reverse-conformance', () => {
  afterEach(() => {
    delete process.env.CHAOS_WEBHOOK_ILLEGAL_TRANSITION
  })

  it('records only legal machine edges as spans when a delivery succeeds', async () => {
    const ctx = await setupWebhooksTest()
    const sub = await seedSubscription(ctx)
    await enqueueDelivery(ctx, { subscriptionId: sub.id })
    const sink = recordingSink()
    await drainToQuiescence(ctx, makeWorker(ctx, okSender(), { deliverySink: sink }))
    await ctx.close()

    expect(sink.records.map((t) => `${t.from}-${t.event}->${t.to}`)).toEqual([
      'Pending-AttemptStarted->Delivering',
      'Delivering-DeliverySucceeded->Delivered',
    ])
    for (const t of sink.records) expect(isLegalEdge(t)).toBe(true)
  })

  it('CHAOS_WEBHOOK_ILLEGAL_TRANSITION emits an off-model span that reverse-conformance catches', async () => {
    process.env.CHAOS_WEBHOOK_ILLEGAL_TRANSITION = '1'
    const ctx = await setupWebhooksTest()
    const sub = await seedSubscription(ctx)
    await enqueueDelivery(ctx, { subscriptionId: sub.id })
    const sink = recordingSink()
    await drainToQuiescence(ctx, makeWorker(ctx, okSender(), { deliverySink: sink }))
    await ctx.close()

    // The bug emits Pending → Delivered directly (skipping Delivering) — not a legal edge.
    const offModel = sink.records.filter((t) => !isLegalEdge(t))
    expect(offModel).toContainEqual(
      expect.objectContaining({ from: 'Pending', to: 'Delivered', event: 'DeliverySucceeded' }),
    )
  })
})

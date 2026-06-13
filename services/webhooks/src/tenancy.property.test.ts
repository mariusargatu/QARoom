import { WebhookEventType } from '@qaroom/contracts'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { setupWebhooksTest } from '../tests/harness'

/**
 * Tenant isolation as a real property (Commitment 9), not a single example: an arbitrary
 * interleaved sequence of subscription registrations is spread across THREE communities, and
 * every community's subscription list must contain exactly its own subscriptions and nothing
 * from another tenant. A dropped/incorrect `community_id` filter on listSubscriptions fails this
 * on the first case where two tenants are populated — which a fixed one-subscription-two-community
 * test could miss.
 */
const COMMS = [
  'comm_01HZY0K7M3QF8VN2J5RX9TB4CD',
  'comm_01HZY0K7M3QF8VN2J5RX9TB4CE',
  'comm_01HZY0K7M3QF8VN2J5RX9TB4C0',
] as const

// A non-empty selection drawn from the closed event-type enum (so it cannot drift from contracts).
const eventTypesArb = fc.uniqueArray(fc.constantFrom(...WebhookEventType.options), {
  minLength: 1,
  maxLength: WebhookEventType.options.length,
})

describe('community tenancy isolation (property)', () => {
  it('subscriptions created across three communities each appear only in their own list, never another tenant’s', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ comm: fc.nat({ max: 2 }), eventTypes: eventTypesArb }), {
          minLength: 1,
          maxLength: 6,
        }),
        async (ops) => {
          const ctx = await setupWebhooksTest()
          const expected = [0, 0, 0]
          let n = 0
          for (const op of ops) {
            const res = await ctx.request.post(
              `/api/communities/${COMMS[op.comm]}/webhook-subscriptions`,
              { url: 'https://hooks.example.com/qaroom', event_types: op.eventTypes },
              {
                'idempotency-key': `w-${n++}`,
              },
            )
            // Only a 201 registers a subscription; anything else is not counted.
            expected[op.comm] = (expected[op.comm] ?? 0) + (res.status === 201 ? 1 : 0)
          }
          for (const i of [0, 1, 2]) {
            const list = await ctx.request.get(`/api/communities/${COMMS[i]}/webhook-subscriptions`)
            expect((list.json as { webhooks: unknown[] }).webhooks.length).toBe(expected[i])
          }
          await ctx.close()
        },
      ),
      { numRuns: 12 },
    )
  })
})

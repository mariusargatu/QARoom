import { idempotencyKeyArb } from '@qaroom/testing-utils/generators'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { SAMPLE, setupWebhooksTest } from '../tests/harness'

const body = { url: 'https://hooks.example.com/qaroom', event_types: ['post.created'] }

describe('idempotent webhook creation (property)', () => {
  it('creating a subscription twice with the same Idempotency-Key yields one subscription and identical responses', async () => {
    await fc.assert(
      fc.asyncProperty(idempotencyKeyArb, async (key) => {
        const ctx = await setupWebhooksTest()
        const url = `/api/communities/${SAMPLE.communityA}/webhook-subscriptions`
        const first = await ctx.request.post(url, body, { 'idempotency-key': key })
        const second = await ctx.request.post(url, body, { 'idempotency-key': key })
        const list = await ctx.request.get(url)
        await ctx.close()

        expect(first.status).toBe(201)
        expect(second.json).toEqual(first.json)
        expect((list.json as { webhooks: unknown[] }).webhooks).toHaveLength(1)
      }),
      { numRuns: 10 },
    )
  })
})

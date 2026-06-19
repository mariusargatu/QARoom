import { test } from '@fast-check/vitest'
import { idempotencyKeyArb } from '@qaroom/testing-utils/generators'
import { withResource } from '@qaroom/testing-utils/harness'
import { describe, expect } from 'vitest'
import { SAMPLE, setupWebhooksTest } from '../tests/harness'

const body = { url: 'https://hooks.example.com/qaroom', event_types: ['post.created'] }

describe('idempotent webhook creation (property)', () => {
  test.prop([idempotencyKeyArb], { numRuns: 10 })(
    'creating a subscription twice with the same Idempotency-Key yields one subscription and identical responses',
    (key) =>
      withResource(
        () => setupWebhooksTest(),
        async (ctx) => {
          const url = `/api/communities/${SAMPLE.communityA}/webhook-subscriptions`
          const first = await ctx.request.post(url, body, { 'idempotency-key': key })
          const second = await ctx.request.post(url, body, { 'idempotency-key': key })
          const list = await ctx.request.get(url)

          expect(first.status).toBe(201)
          expect(second.json).toEqual(first.json)
          expect((list.json as { webhooks: unknown[] }).webhooks).toHaveLength(1)
        },
      ),
  )
})

import { test } from '@fast-check/vitest'
import { idempotencyKeyArb } from '@qaroom/testing-utils/generators'
import { withResource } from '@qaroom/testing-utils/harness'
import { describe, expect } from 'vitest'
import { enableDonations, SAMPLE, setupDonationsTest } from '../tests/harness'

const body = { donor_id: SAMPLE.user, amount_cents: 2500, currency: 'USD' }

describe('idempotent donation creation (property)', () => {
  test.prop([idempotencyKeyArb], { numRuns: 10 })(
    'creating a donation twice with the same Idempotency-Key yields one donation and identical responses',
    (key) =>
      withResource(
        () => setupDonationsTest(),
        async (ctx) => {
          await enableDonations(ctx, SAMPLE.communityA)
          const url = `/api/communities/${SAMPLE.communityA}/donations`
          const first = await ctx.request.post(url, body, { 'idempotency-key': key })
          const second = await ctx.request.post(url, body, { 'idempotency-key': key })
          const list = await ctx.request.get(url)

          expect(first.status).toBe(201)
          expect(second.json).toEqual(first.json)
          expect((list.json as { donations: unknown[] }).donations).toHaveLength(1)
        },
      ),
  )
})

import { idempotencyKeyArb } from '@qaroom/testing-utils/generators'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { enableDonations, SAMPLE, setupDonationsTest } from '../tests/harness'

const body = { donor_id: SAMPLE.user, amount_cents: 2500, currency: 'USD' }

describe('idempotent donation creation (property)', () => {
  it('creating a donation twice with the same Idempotency-Key yields one donation and identical responses', async () => {
    await fc.assert(
      fc.asyncProperty(idempotencyKeyArb, async (key) => {
        const ctx = await setupDonationsTest()
        await enableDonations(ctx, SAMPLE.communityA)
        const url = `/api/communities/${SAMPLE.communityA}/donations`
        const first = await ctx.request.post(url, body, { 'idempotency-key': key })
        const second = await ctx.request.post(url, body, { 'idempotency-key': key })
        const list = await ctx.request.get(url)
        await ctx.close()

        expect(first.status).toBe(201)
        expect(second.json).toEqual(first.json)
        expect((list.json as { donations: unknown[] }).donations).toHaveLength(1)
      }),
      { numRuns: 10 },
    )
  })
})

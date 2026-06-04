import { createDonationRequestArb } from '@qaroom/testing-utils/generators'
import { expectRFC7807 } from '@qaroom/testing-utils/matchers'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { enableDonations, nextKey, SAMPLE, setupDonationsTest } from '../tests/harness'

describe('donation gating (property)', () => {
  it('any donation is rejected with 409 while the flag is not enabled', async () => {
    await fc.assert(
      fc.asyncProperty(createDonationRequestArb, async (body) => {
        const ctx = await setupDonationsTest()
        const res = await ctx.request.post(
          `/api/communities/${SAMPLE.communityA}/donations`,
          body,
          { 'idempotency-key': nextKey() },
        )
        await ctx.close()
        expectRFC7807(res.json, { status: 409, failureDomain: 'conflict' })
      }),
      { numRuns: 10 },
    )
  })

  it('any donation is recorded once the flag is enabled', async () => {
    await fc.assert(
      fc.asyncProperty(createDonationRequestArb, async (body) => {
        const ctx = await setupDonationsTest()
        await enableDonations(ctx, SAMPLE.communityA)
        const res = await ctx.request.post(
          `/api/communities/${SAMPLE.communityA}/donations`,
          body,
          { 'idempotency-key': nextKey() },
        )
        await ctx.close()
        expect(res.status).toBe(201)
        expect(res.json).toMatchObject({ status: 'Captured', amount_cents: body.amount_cents })
      }),
      { numRuns: 10 },
    )
  })
})

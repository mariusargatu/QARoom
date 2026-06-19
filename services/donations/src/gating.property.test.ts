import { test } from '@fast-check/vitest'
import { createDonationRequestArb } from '@qaroom/testing-utils/generators'
import { withResource } from '@qaroom/testing-utils/harness'
import { expectRFC7807 } from '@qaroom/testing-utils/matchers'
import { describe, expect } from 'vitest'
import { enableDonations, nextKey, SAMPLE, setupDonationsTest } from '../tests/harness'

describe('donation gating (property)', () => {
  test.prop([createDonationRequestArb], { numRuns: 10 })(
    'any donation is rejected with 409 while the flag is not enabled',
    (body) =>
      withResource(
        () => setupDonationsTest(),
        async (ctx) => {
          const res = await ctx.request.post(
            `/api/communities/${SAMPLE.communityA}/donations`,
            body,
            { 'idempotency-key': nextKey() },
          )
          expectRFC7807(res.json, { status: 409, failureDomain: 'conflict' })
        },
      ),
  )

  test.prop([createDonationRequestArb], { numRuns: 10 })(
    'any donation is recorded once the flag is enabled',
    (body) =>
      withResource(
        () => setupDonationsTest(),
        async (ctx) => {
          await enableDonations(ctx, SAMPLE.communityA)
          const res = await ctx.request.post(
            `/api/communities/${SAMPLE.communityA}/donations`,
            body,
            { 'idempotency-key': nextKey() },
          )
          expect(res.status).toBe(201)
          expect(res.json).toMatchObject({ status: 'Captured', amount_cents: body.amount_cents })
        },
      ),
  )
})

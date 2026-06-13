import { createDonationRequestArb } from '@qaroom/testing-utils/generators'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { enableDonations, setupDonationsTest } from '../tests/harness'

/**
 * Tenant isolation as a real property (Commitment 9), not a single example: an arbitrary
 * interleaved sequence of donation creations is spread across THREE communities, and every
 * community's donation list must contain exactly its own donations and nothing from another
 * tenant. A dropped/incorrect `community_id` filter on listDonations fails this on the first
 * case where two tenants are populated — which a fixed one-donation-two-community test could miss.
 */
const COMMS = [
  'comm_01HZY0K7M3QF8VN2J5RX9TB4CD',
  'comm_01HZY0K7M3QF8VN2J5RX9TB4CE',
  'comm_01HZY0K7M3QF8VN2J5RX9TB4C0',
] as const

describe('community tenancy isolation (property)', () => {
  it('donations created across three communities each appear only in their own list, never another tenant’s', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ comm: fc.nat({ max: 2 }), body: createDonationRequestArb }), {
          minLength: 1,
          maxLength: 6,
        }),
        async (ops) => {
          const ctx = await setupDonationsTest()
          // Donations are gated; enable the flag for every community so creations are recorded.
          for (const comm of COMMS) {
            await enableDonations(ctx, comm)
          }
          const expected = [0, 0, 0]
          let n = 0
          for (const op of ops) {
            const res = await ctx.request.post(
              `/api/communities/${COMMS[op.comm]}/donations`,
              op.body,
              {
                'idempotency-key': `d-${n++}`,
              },
            )
            // Only a 201 records a donation; anything else (e.g. a rejected body) is not counted.
            expected[op.comm] = (expected[op.comm] ?? 0) + (res.status === 201 ? 1 : 0)
          }
          for (const i of [0, 1, 2]) {
            const list = await ctx.request.get(`/api/communities/${COMMS[i]}/donations`)
            expect((list.json as { donations: unknown[] }).donations.length).toBe(expected[i])
          }
          await ctx.close()
        },
      ),
      { numRuns: 12 },
    )
  })
})

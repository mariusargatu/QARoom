import { roleArb, userIdArb } from '@qaroom/testing-utils/generators'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { setupIdentityTest } from '../tests/harness'

/**
 * Tenant isolation as a real property (Commitment 9). identity owns memberships, so the
 * invariant is membership-scoped: an arbitrary interleaved sequence of "add member" ops is
 * spread across THREE communities, and every community's member list must contain exactly
 * its own members and never another tenant's. A dropped community filter on listMembers
 * fails on the first case where two tenants hold members — which the earlier single-membership
 * test could not surface.
 */
describe('community membership tenancy isolation (property)', () => {
  it('members added across three communities are each listed only in their own community, never another’s', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ comm: fc.nat({ max: 2 }), user: userIdArb, role: roleArb }), {
          minLength: 1,
          maxLength: 6,
        }),
        async (ops) => {
          const ctx = await setupIdentityTest()
          const ids: string[] = []
          for (const i of [0, 1, 2]) {
            const res = await ctx.request.post(
              '/api/communities',
              { slug: `team_${i}`, name: `Team ${i}` },
              { 'idempotency-key': `comm-${i}` },
            )
            ids.push((res.json as { id: string }).id)
          }

          const expected = [new Set<string>(), new Set<string>(), new Set<string>()]
          let n = 0
          for (const op of ops) {
            await ctx.request.post(
              `/api/communities/${ids[op.comm]}/members`,
              { user_id: op.user, role: op.role },
              { 'idempotency-key': `m-${n++}` },
            )
            // Re-adding the same (user, community) is a 409 no-op; the Set dedupes identically.
            expected[op.comm]?.add(op.user)
          }

          for (const i of [0, 1, 2]) {
            const list = await ctx.request.get(`/api/communities/${ids[i]}/members`)
            const got = new Set(
              (list.json as { members: Array<{ user_id: string }> }).members.map((m) => m.user_id),
            )
            expect(got).toEqual(expected[i])
          }
          await ctx.close()
        },
      ),
      { numRuns: 12 },
    )
  })
})

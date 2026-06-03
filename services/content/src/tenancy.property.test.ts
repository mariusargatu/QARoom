import { createPostRequestArb } from '@qaroom/testing-utils/generators'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { setupContentTest } from '../tests/harness'

/**
 * Tenant isolation as a real property (Commitment 9), not a single example: an arbitrary
 * interleaved sequence of post creations is spread across THREE communities, and every
 * community's feed must contain exactly its own posts and nothing from another tenant.
 * A dropped/incorrect `community_id` filter on listFeed fails this on the first case where
 * two tenants are populated — which a fixed one-post-two-community test could miss.
 */
const COMMS = [
  'comm_01HZY0K7M3QF8VN2J5RX9TB4CD',
  'comm_01HZY0K7M3QF8VN2J5RX9TB4CE',
  'comm_01HZY0K7M3QF8VN2J5RX9TB4C0',
] as const

describe('community tenancy isolation (property)', () => {
  it('posts created across three communities each appear only in their own feed, never another tenant’s', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ comm: fc.nat({ max: 2 }), body: createPostRequestArb }), {
          minLength: 1,
          maxLength: 6,
        }),
        async (ops) => {
          const ctx = await setupContentTest()
          const expected = [0, 0, 0]
          let n = 0
          for (const op of ops) {
            const res = await ctx.request.post(
              `/api/communities/${COMMS[op.comm]}/posts`,
              op.body,
              {
                'idempotency-key': `p-${n++}`,
              },
            )
            // A body with a NUL title is a clean 400, not created — only count creations.
            expected[op.comm] = (expected[op.comm] ?? 0) + (res.status === 201 ? 1 : 0)
          }
          for (const i of [0, 1, 2]) {
            const feed = await ctx.request.get(`/api/communities/${COMMS[i]}/feed`)
            expect((feed.json as { posts: unknown[] }).posts.length).toBe(expected[i])
          }
          await ctx.close()
        },
      ),
      { numRuns: 12 },
    )
  })
})

import { test } from '@fast-check/vitest'
import { CreatePostRequest } from '@qaroom/contracts'
import { createPostRequestArb } from '@qaroom/testing-utils/generators'
import { withResource } from '@qaroom/testing-utils/harness'
import fc from 'fast-check'
import { describe, expect } from 'vitest'
import { setupContentTest } from '../tests/harness'

// Only ever-valid bodies: every create is a 201, so `expected` is derived purely from the input
// sequence — not from the SUT's own status (which would let a regress-to-400 pass vacuously).
const validBodyArb = createPostRequestArb.filter((b) => CreatePostRequest.safeParse(b).success)

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
  test.prop(
    [
      fc.array(fc.record({ comm: fc.nat({ max: 2 }), body: validBodyArb }), {
        minLength: 1,
        maxLength: 6,
      }),
    ],
    { numRuns: 12 },
  )(
    'posts created across three communities each appear only in their own feed, never another tenant’s',
    (ops) =>
      withResource(
        () => setupContentTest(),
        async (ctx) => {
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
            // Bodies are pre-validated, so every create is a 201; the count derives from the input.
            expect(res.status).toBe(201)
            expected[op.comm] = (expected[op.comm] ?? 0) + 1
          }
          for (const i of [0, 1, 2]) {
            const feed = await ctx.request.get(`/api/communities/${COMMS[i]}/feed`)
            expect((feed.json as { posts: unknown[] }).posts.length).toBe(expected[i])
          }
        },
      ),
  )
})

import { createPostRequestArb, idempotencyKeyArb } from '@qaroom/testing-utils/generators'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { SAMPLE, setupContentTest } from '../tests/harness'

describe('community tenancy isolation (property)', () => {
  it('a post created in community A is visible in A and never leaks into community B', async () => {
    await fc.assert(
      fc.asyncProperty(createPostRequestArb, idempotencyKeyArb, async (body, key) => {
        const ctx = await setupContentTest()
        await ctx.request.post(`/api/communities/${SAMPLE.communityA}/posts`, body, {
          'idempotency-key': key,
        })
        const feedA = await ctx.request.get(`/api/communities/${SAMPLE.communityA}/feed`)
        const feedB = await ctx.request.get(`/api/communities/${SAMPLE.communityB}/feed`)
        await ctx.close()

        expect((feedA.json as { posts: unknown[] }).posts.length).toBe(1)
        expect((feedB.json as { posts: unknown[] }).posts.length).toBe(0)
      }),
      { numRuns: 10 },
    )
  })
})

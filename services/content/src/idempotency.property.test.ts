import { createPostRequestArb, idempotencyKeyArb } from '@qaroom/testing-utils/generators'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { SAMPLE, setupContentTest } from '../tests/harness'

describe('idempotent post creation (property)', () => {
  it('creating a post twice with the same Idempotency-Key yields one post and an identical response', async () => {
    await fc.assert(
      fc.asyncProperty(createPostRequestArb, idempotencyKeyArb, async (body, key) => {
        const ctx = await setupContentTest()
        const first = await ctx.request.post(`/api/communities/${SAMPLE.communityA}/posts`, body, {
          'idempotency-key': key,
        })
        const second = await ctx.request.post(`/api/communities/${SAMPLE.communityA}/posts`, body, {
          'idempotency-key': key,
        })
        const state = await ctx.request.get('/system/state')
        await ctx.close()

        expect(first.status).toBe(201)
        expect(second.json).toEqual(first.json)
        expect((state.json as { models: { posts: { count: number } } }).models.posts.count).toBe(1)
      }),
      { numRuns: 10 },
    )
  })
})

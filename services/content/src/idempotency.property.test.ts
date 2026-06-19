import { test } from '@fast-check/vitest'
import { createPostRequestArb, idempotencyKeyArb } from '@qaroom/testing-utils/generators'
import { withResource } from '@qaroom/testing-utils/harness'
import { describe, expect } from 'vitest'
import { SAMPLE, setupContentTest } from '../tests/harness'

describe('idempotent post creation (property)', () => {
  test.prop([createPostRequestArb, idempotencyKeyArb], { numRuns: 10 })(
    'creating a post twice with the same Idempotency-Key yields one post and an identical response',
    (body, key) =>
      withResource(
        () => setupContentTest(),
        async (ctx) => {
          const first = await ctx.request.post(`/api/communities/${SAMPLE.communityA}/posts`, body, {
            'idempotency-key': key,
          })
          const second = await ctx.request.post(`/api/communities/${SAMPLE.communityA}/posts`, body, {
            'idempotency-key': key,
          })
          const state = await ctx.request.get('/system/state')

          expect(first.status).toBe(201)
          expect(second.json).toEqual(first.json)
          expect((state.json as { models: { posts: { count: number } } }).models.posts.count).toBe(1)
        },
      ),
  )
})

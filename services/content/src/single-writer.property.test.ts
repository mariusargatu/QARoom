import { userIdArb, voteValueArb } from '@qaroom/testing-utils/generators'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { SAMPLE, setupContentTest } from '../tests/harness'

const AUTHOR = 'user_00000000000000000000000000'

describe('single-writer-per-resource: concurrent votes on one post serialize without lost updates', () => {
  it('the final score equals the sum of every distinct voter vote, whatever the interleaving', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.record({ voter: userIdArb, value: voteValueArb }), {
          selector: (entry) => entry.voter,
          minLength: 1,
          maxLength: 8,
        }),
        async (votes) => {
          const ctx = await setupContentTest()
          const created = await ctx.request.post(
            `/api/communities/${SAMPLE.communityA}/posts`,
            { author_id: AUTHOR, title: 'concurrent', body: 'votes' },
            { 'idempotency-key': 'create-post' },
          )
          const postId = (created.json as { id: string }).id

          // Fire every vote concurrently: the advisory lock + SELECT … FOR UPDATE must
          // serialize them so no update is lost (Commitment 4).
          await Promise.all(
            votes.map((entry, i) =>
              ctx.request.post(
                `/api/posts/${postId}/votes`,
                { voter_id: entry.voter, value: entry.value },
                { 'idempotency-key': `vote-${i}` },
              ),
            ),
          )

          const fetched = await ctx.request.get(`/api/posts/${postId}`)
          await ctx.close()

          const expected = votes.reduce((sum, entry) => sum + entry.value, 0)
          expect((fetched.json as { score: number }).score).toBe(expected)
        },
      ),
      { numRuns: 15 },
    )
  })
})

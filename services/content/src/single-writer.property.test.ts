import { test } from '@fast-check/vitest'
import { userIdArb, voteValueArb } from '@qaroom/testing-utils/generators'
import { withResource } from '@qaroom/testing-utils/harness'
import fc from 'fast-check'
import { describe, expect } from 'vitest'
import { SAMPLE, setupContentTest } from '../tests/harness'

const AUTHOR = 'user_00000000000000000000000000'

describe('single-writer-per-resource: concurrent votes on one post serialize without lost updates', () => {
  test.prop(
    [
      fc.uniqueArray(fc.record({ voter: userIdArb, value: voteValueArb }), {
        selector: (entry) => entry.voter,
        minLength: 1,
        maxLength: 8,
      }),
    ],
    // numRuns matches the fleet norm (content's idempotency/tenancy props run 10/12). At 15 this was
    // the heaviest property test in the repo (15 fresh-PGlite builds × up to 8 CONCURRENT votes), and
    // the only one whose wall-clock outran the contention-aware timeout under a simultaneous,
    // uncapped multi-package launch (where `os.loadavg()` lags and the timeout can't scale). 10 runs ×
    // 8-way interleaving keeps the serialization invariant's teeth; the per-iteration concurrency, not
    // the run count, is what exercises Commitment 4.
    { numRuns: 10 },
  )(
    'the final score equals the sum of every distinct voter vote, whatever the interleaving',
    (votes) =>
      withResource(
        () => setupContentTest(),
        async (ctx) => {
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
          const expected = votes.reduce((sum, entry) => sum + entry.value, 0)
          expect((fetched.json as { score: number }).score).toBe(expected)
        },
      ),
  )
})

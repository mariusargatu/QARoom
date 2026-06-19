import { test } from '@fast-check/vitest'
import { flagKeyArb } from '@qaroom/testing-utils/generators'
import { withResource } from '@qaroom/testing-utils/harness'
import { describe, expect } from 'vitest'
import { nextKey, SAMPLE, setupFlagsTest } from '../tests/harness'

describe('flag tenancy isolation (property)', () => {
  test.prop([flagKeyArb], { numRuns: 10 })(
    'advancing a flag in one community never changes its resolution in another',
    (flagKey) =>
      withResource(
        () => setupFlagsTest(),
        async (ctx) => {
          await ctx.request.post(
            `/api/communities/${SAMPLE.communityA}/flags/${flagKey}/rollout`,
            { event: 'EnableRequested' },
            { 'idempotency-key': nextKey() },
          )
          const inA = await ctx.request.get(
            `/api/communities/${SAMPLE.communityA}/flags/${flagKey}`,
          )
          const inB = await ctx.request.get(
            `/api/communities/${SAMPLE.communityB}/flags/${flagKey}`,
          )

          expect((inA.json as { state: string }).state).toBe('Enabling')
          // The other tenant is untouched — still at the initial Off state.
          expect((inB.json as { state: string }).state).toBe('Off')
        },
      ),
  )
})

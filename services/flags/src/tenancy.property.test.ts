import { flagKeyArb } from '@qaroom/testing-utils/generators'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { nextKey, SAMPLE, setupFlagsTest } from '../tests/harness'

describe('flag tenancy isolation (property)', () => {
  it('advancing a flag in one community never changes its resolution in another', async () => {
    await fc.assert(
      fc.asyncProperty(flagKeyArb, async (flagKey) => {
        const ctx = await setupFlagsTest()
        await ctx.request.post(
          `/api/communities/${SAMPLE.communityA}/flags/${flagKey}/rollout`,
          { event: 'EnableRequested' },
          { 'idempotency-key': nextKey() },
        )
        const inA = await ctx.request.get(`/api/communities/${SAMPLE.communityA}/flags/${flagKey}`)
        const inB = await ctx.request.get(`/api/communities/${SAMPLE.communityB}/flags/${flagKey}`)
        await ctx.close()

        expect((inA.json as { state: string }).state).toBe('Enabling')
        // The other tenant is untouched — still at the initial Off state.
        expect((inB.json as { state: string }).state).toBe('Off')
      }),
      { numRuns: 10 },
    )
  })
})

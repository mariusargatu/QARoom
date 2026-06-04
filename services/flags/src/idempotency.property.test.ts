import { idempotencyKeyArb } from '@qaroom/testing-utils/generators'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { SAMPLE, setupFlagsTest } from '../tests/harness'

describe('idempotent rollout advance (property)', () => {
  it('advancing with the same Idempotency-Key twice transitions once and replays the response', async () => {
    await fc.assert(
      fc.asyncProperty(idempotencyKeyArb, async (key) => {
        const ctx = await setupFlagsTest()
        const url = `/api/communities/${SAMPLE.communityA}/flags/${SAMPLE.flag}/rollout`
        const first = await ctx.request.post(
          url,
          { event: 'EnableRequested' },
          { 'idempotency-key': key },
        )
        const second = await ctx.request.post(
          url,
          { event: 'EnableRequested' },
          { 'idempotency-key': key },
        )
        const transitionCount = ctx.transitions.length
        await ctx.close()

        expect(first.status).toBe(200)
        expect(second.json).toEqual(first.json)
        // The replay served the stored response WITHOUT re-running the transition.
        expect(transitionCount).toBe(1)
      }),
      { numRuns: 10 },
    )
  })
})

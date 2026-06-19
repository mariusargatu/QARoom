import { test } from '@fast-check/vitest'
import { idempotencyKeyArb } from '@qaroom/testing-utils/generators'
import { withResource } from '@qaroom/testing-utils/harness'
import { describe, expect } from 'vitest'
import { SAMPLE, setupFlagsTest } from '../tests/harness'

describe('idempotent rollout advance (property)', () => {
  test.prop([idempotencyKeyArb], { numRuns: 10 })(
    'advancing with the same Idempotency-Key twice transitions once and replays the response',
    (key) =>
      withResource(
        () => setupFlagsTest(),
        async (ctx) => {
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

          expect(first.status).toBe(200)
          expect(second.json).toEqual(first.json)
          // The replay served the stored response WITHOUT re-running the transition.
          expect(transitionCount).toBe(1)
        },
      ),
  )
})

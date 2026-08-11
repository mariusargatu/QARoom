import { expectEveryOperationRouted } from '@qaroom/testing-utils/matchers'
import { afterEach, describe, expect, it } from 'vitest'
import { OPERATIONS } from '../src/contract/operations'
import { setupDonationsTest } from './harness'

/**
 * Registry vs the ROUTER.
 *
 * `openapi:verify` proves the committed spec matches the operation registry, and
 * `/system/capabilities` is generated from that same registry — so every existing gate compares two
 * artifacts derived from one source. None of them can see that an operation has no handler
 * registered: add an entry to OPERATIONS, regenerate, commit, and the spec documents a route that
 * 404s. Only live fuzzing would catch it, in a Docker lane. `hasRoute` asks the running app.
 */
describe('donations-service serves every operation it declares', () => {
  let ctx: Awaited<ReturnType<typeof setupDonationsTest>>
  afterEach(async () => {
    await ctx.close()
  })

  it('every operation in the registry is registered on the app (not just documented)', async () => {
    ctx = await setupDonationsTest()
    expectEveryOperationRouted(ctx.app, OPERATIONS)
  })

  it('checks a non-empty registry (an emptied OPERATIONS would pass vacuously)', async () => {
    ctx = await setupDonationsTest()
    expect(OPERATIONS.length).toBeGreaterThan(0)
  })
})

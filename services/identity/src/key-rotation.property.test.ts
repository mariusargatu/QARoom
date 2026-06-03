import { UserId } from '@qaroom/contracts'
import { userIdArb } from '@qaroom/testing-utils/generators'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { setupIdentityTest } from '../tests/harness'

/**
 * Rotation continuity (ADR-0008). A rotated-out 'previous' key stays JWKS-eligible until
 * its grace window closes — driven by the injected logical clock, so it is deterministically
 * testable by advancing a FakeClock. Token TTL is set far beyond the grace window so the
 * past-grace rejection is attributable to grace expiry, not token expiry.
 */
const GRACE_MS = 1000
const LONG_TTL_SECONDS = 100_000

describe('signing-key rotation continuity (property)', () => {
  it('a token issued under the old kid still verifies before the grace window closes', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        fc.integer({ min: 0, max: GRACE_MS - 1 }),
        async (userId, advanceBy) => {
          const ctx = await setupIdentityTest({
            rotation: { graceMs: GRACE_MS },
            tokenTtlSeconds: LONG_TTL_SECONDS,
          })
          const issued = await ctx.issuer.issue({ sub: UserId.parse(userId), memberships: [] })
          await ctx.keyStore.rotate()
          ctx.clock.advance(advanceBy)
          const claims = await ctx.issuer.verify(issued.token)
          await ctx.close()
          expect(claims.sub).toBe(userId)
        },
      ),
      { numRuns: 8 },
    )
  })

  it('a token issued under the old kid is rejected after the grace window closes', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        fc.integer({ min: GRACE_MS + 1, max: GRACE_MS * 4 }),
        async (userId, advanceBy) => {
          const ctx = await setupIdentityTest({
            rotation: { graceMs: GRACE_MS },
            tokenTtlSeconds: LONG_TTL_SECONDS,
          })
          const issued = await ctx.issuer.issue({ sub: UserId.parse(userId), memberships: [] })
          await ctx.keyStore.rotate()
          ctx.clock.advance(advanceBy)
          await expect(ctx.issuer.verify(issued.token)).rejects.toMatchObject({
            problem: { failure_domain: 'authentication' },
          })
          await ctx.close()
        },
      ),
      { numRuns: 8 },
    )
  })

  // Multiple rotations accumulate multiple 'previous' keys; the JWKS-eligible set must keep
  // every one still inside its own grace window and drop only those past it (per-key grace,
  // not a single global window).
  it('keeps each previous key JWKS-eligible within its own grace window across multiple rotations', async () => {
    const ctx = await setupIdentityTest({
      rotation: { graceMs: GRACE_MS },
      tokenTtlSeconds: LONG_TTL_SECONDS,
    })
    await ctx.keyStore.ensureCurrent() // K1 current
    await ctx.keyStore.rotate() // K1 → previous (retired @ T0), K2 current
    ctx.clock.advance(500)
    await ctx.keyStore.rotate() // K2 → previous (retired @ T0+500), K3 current

    // now = T0+500: K3 current, K2 (retired+grace = T0+1500) and K1 (T0+1000) both still in grace.
    expect((await ctx.keyStore.jwksEligible()).length).toBe(3)

    ctx.clock.advance(600) // now = T0+1100: K1's grace (T0+1000) has closed; K2's (T0+1500) has not.
    const eligible = await ctx.keyStore.jwksEligible()
    expect(eligible.length).toBe(2)
    expect(eligible.filter((k) => k.status === 'current').length).toBe(1)
    await ctx.close()
  })
})

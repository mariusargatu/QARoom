import { EXAMPLE_USER_ID, UserId } from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'
import { setupIdentityTest } from '../tests/harness'

/**
 * Session fixation (OWASP API#2): a session token must not outlive the signing key that minted it.
 * A token issued under the OLD key, presented after a rotation whose grace window has closed, is
 * rejected — while a freshly issued session (new token, current key) still verifies at the SAME
 * logical instant. That pairing is the fixation-specific claim the key-rotation property test does
 * not make (it asserts only that the old token dies): rotation invalidates the rotated-out session,
 * not the issuer wholesale. Driven by the injected Clock (ADR-0008): grace expiry is logical time.
 */
const GRACE_MS = 1000
const LONG_TTL = 100_000
const SUB = UserId.parse(EXAMPLE_USER_ID)

describe('session fixation: a rotated-out token does not survive grace expiry', () => {
  it('rejects the pre-rotation token after grace closes, yet still verifies a freshly issued one', async () => {
    const ctx = await setupIdentityTest({
      rotation: { graceMs: GRACE_MS },
      tokenTtlSeconds: LONG_TTL,
    })
    const fixed = await ctx.issuer.issue({ sub: SUB, memberships: [] })
    await ctx.keyStore.rotate()
    ctx.clock.advance(GRACE_MS + 1)

    // The fixed (pre-rotation) token is rejected: its key is retired past grace.
    await expect(ctx.issuer.verify(fixed.token)).rejects.toMatchObject({
      problem: { status: 401, failure_domain: 'authentication' },
    })
    // A fresh session minted at the SAME instant (under the new current key) still verifies — so the
    // rejection is attributable to the rotated-out session, not a broken verifier.
    const fresh = await ctx.issuer.issue({ sub: SUB, memberships: [] })
    const claims = await ctx.issuer.verify(fresh.token)
    expect(claims.sub).toBe(SUB)

    await ctx.close()
  })
})

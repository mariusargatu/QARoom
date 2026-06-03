import { UserId } from '@qaroom/contracts'
import { keyIdArb, userIdArb } from '@qaroom/testing-utils/generators'
import fc from 'fast-check'
import { importJWK, SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import { ISSUER } from '../src/jwt'
import { ALIEN_PRIVATE_JWK, TEST_PRIVATE_JWK } from '../tests/fixtures/test-key-material'
import { SAMPLE, setupIdentityTest } from '../tests/harness'

const authRejection = { problem: { failure_domain: 'authentication' } }

describe('JWT validation (property)', () => {
  it('a token whose exp has passed under the logical clock is rejected as an authentication problem', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, async (userId) => {
        const ctx = await setupIdentityTest({ tokenTtlSeconds: 1 })
        const issued = await ctx.issuer.issue({ sub: UserId.parse(userId), memberships: [] })
        ctx.clock.advance(2000) // 2s of logical time > the 1s TTL
        await expect(ctx.issuer.verify(issued.token)).rejects.toMatchObject(authRejection)
        await ctx.close()
      }),
      { numRuns: 8 },
    )
  })

  it('a token bearing a kid absent from the JWKS-eligible set is rejected', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, keyIdArb, async (userId, forgedKid) => {
        const ctx = await setupIdentityTest()
        await ctx.keyStore.ensureCurrent()
        const nowSec = Math.floor(ctx.clock.now().getTime() / 1000)
        const token = await new SignJWT({ memberships: [] })
          .setProtectedHeader({ alg: 'ES256', kid: forgedKid })
          .setSubject(UserId.parse(userId))
          .setIssuer(ISSUER)
          .setIssuedAt(nowSec)
          .setExpirationTime(nowSec + 3600)
          .sign(await importJWK(TEST_PRIVATE_JWK, 'ES256'))
        await expect(ctx.issuer.verify(token)).rejects.toMatchObject(authRejection)
        await ctx.close()
      }),
      { numRuns: 8 },
    )
  })

  it('a token signed by a key absent from the JWKS is rejected even when its kid matches the current key', async () => {
    const ctx = await setupIdentityTest()
    const current = await ctx.keyStore.ensureCurrent()
    const nowSec = Math.floor(ctx.clock.now().getTime() / 1000)
    const token = await new SignJWT({ memberships: [] })
      .setProtectedHeader({ alg: 'ES256', kid: current.kid }) // claims to be the live key…
      .setSubject(SAMPLE.user)
      .setIssuer(ISSUER)
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + 3600)
      .sign(await importJWK(ALIEN_PRIVATE_JWK, 'ES256')) // …but signed with a key never published
    await expect(ctx.issuer.verify(token)).rejects.toMatchObject(authRejection)
    await ctx.close()
  })
})

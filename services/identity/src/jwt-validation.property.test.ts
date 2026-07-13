import { test } from '@fast-check/vitest'
import { UserId } from '@qaroom/contracts'
import { keyIdArb, userIdArb } from '@qaroom/testing-utils/generators'
import { withResource } from '@qaroom/testing-utils/harness'
import { importJWK, SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import { ALIEN_PRIVATE_JWK, TEST_PRIVATE_JWK } from '../tests/fixtures/test-key-material'
import { SAMPLE, setupIdentityTest } from '../tests/harness'
import { ISSUER } from './jwt'

const authRejection = { problem: { failure_domain: 'authentication' } }

describe('JWT validation (property)', () => {
  test.prop([userIdArb], { numRuns: 8 })(
    'a token whose exp has passed under the logical clock is rejected as an authentication problem',
    (userId) =>
      withResource(
        () => setupIdentityTest({ tokenTtlSeconds: 1 }),
        async (ctx) => {
          const issued = await ctx.issuer.issue({ sub: UserId.parse(userId), memberships: [] })
          ctx.clock.advance(2000) // 2s of logical time > the 1s TTL
          await expect(ctx.issuer.verify(issued.token)).rejects.toMatchObject(authRejection)
        },
      ),
  )

  test.prop([userIdArb, keyIdArb], { numRuns: 8 })(
    'a token bearing a kid absent from the JWKS-eligible set is rejected',
    (userId, forgedKid) =>
      withResource(
        () => setupIdentityTest(),
        async (ctx) => {
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
        },
      ),
  )

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

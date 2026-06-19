import { EXAMPLE_USER_ID } from '@qaroom/contracts'
import { unixSeconds } from '@qaroom/determinism'
import { type RepoTest, setupRepoTest } from '@qaroom/testing-utils/harness'
import { importJWK, SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TEST_PRIVATE_JWK, TestKeyMaterialSource } from '../tests/fixtures/test-key-material'
import type { IdentityDb } from './db/client'
import { ensureSchema } from './db/migrate'
import { createIssuer, ISSUER, type Issuer } from './jwt'
import { KeyStore } from './keys'

/**
 * The ES256 issuer/verifier. Property tests cover the signature/rotation matrix; these pin the
 * three rejection branches a property generator rarely lands on — an undecodable header, a token
 * with no kid, and an expired token — each a 401 in the authentication failure domain (Commitment
 * 13). Expiry is driven by the injected Clock, so it is deterministic (advance, don't sleep).
 */
const GRACE_MS = 60 * 60 * 1000

let ctx: RepoTest<IdentityDb>
let keyStore: KeyStore
let issuer: Issuer

const newIssuer = (tokenTtlSeconds: number): Issuer =>
  createIssuer(keyStore, ctx.clock, tokenTtlSeconds)

beforeEach(async () => {
  ctx = await setupRepoTest<IdentityDb>({ applyMigrations: (db) => ensureSchema(db) })
  keyStore = new KeyStore(ctx.db, ctx.clock, ctx.ids, new TestKeyMaterialSource(), {
    graceMs: GRACE_MS,
  })
  issuer = newIssuer(3600)
})

afterEach(async () => {
  await ctx.close()
})

describe('createIssuer round trip', () => {
  it('issues a token whose claims verify back to the same subject and memberships', async () => {
    const issued = await issuer.issue({ sub: EXAMPLE_USER_ID, memberships: [] })

    const claims = await issuer.verify(issued.token)
    expect(claims.sub).toBe(EXAMPLE_USER_ID)
    expect(claims.iss).toBe(ISSUER)
    expect(claims.memberships).toEqual([])
  })
})

describe('createIssuer rejections (all authentication, 401)', () => {
  it('rejects an undecodable token header as token-malformed', async () => {
    await expect(issuer.verify('this.is.not-a-jwt')).rejects.toMatchObject({
      problem: {
        status: 401,
        failure_domain: 'authentication',
        type: expect.stringContaining('token-malformed'),
      },
    })
  })

  it('rejects a token carrying no kid in its header as token-unknown-key', async () => {
    const nowSec = unixSeconds(ctx.clock)
    const noKid = await new SignJWT({ memberships: [] })
      .setProtectedHeader({ alg: 'ES256' }) // no kid
      .setSubject(EXAMPLE_USER_ID)
      .setIssuer(ISSUER)
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + 1000)
      .sign(await importJWK(TEST_PRIVATE_JWK, 'ES256'))

    await expect(issuer.verify(noKid)).rejects.toMatchObject({
      problem: {
        failure_domain: 'authentication',
        type: expect.stringContaining('token-unknown-key'),
      },
    })
  })

  it('rejects a token past its expiry as token-invalid (driven by the injected clock)', async () => {
    const shortLived = newIssuer(60)
    const issued = await shortLived.issue({ sub: EXAMPLE_USER_ID, memberships: [] })

    // Negative control for the "driven by the injected clock" claim: BEFORE advancing, the token
    // verifies. A FakeClock-base token (exp ≈ 2026-01-01 + 60s) reads as expired under real
    // wall-clock, so this pre-advance success can only hold if verify() honors clock.now() — it
    // falsifies deleting the `currentDate: clock.now()` injection, which the post-advance check alone
    // would not (wall-clock is already months past the token's exp).
    await expect(shortLived.verify(issued.token)).resolves.toMatchObject({ sub: EXAMPLE_USER_ID })

    ctx.clock.advance(61_000) // past exp

    await expect(shortLived.verify(issued.token)).rejects.toMatchObject({
      problem: { failure_domain: 'authentication', type: expect.stringContaining('token-invalid') },
    })
  })
})

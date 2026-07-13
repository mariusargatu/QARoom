import { ACCESS_TOKEN_ISSUER, EXAMPLE_COMMUNITY_ID, EXAMPLE_USER_ID } from '@qaroom/contracts'
import type { Clock } from '@qaroom/determinism'
import { type CryptoKey, exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import type { JwksClient } from './clients/jwks-client'
import { createTokenVerifier } from './token-verifier'

// A fixed logical clock: token validity is judged against THIS, never wall-clock (Commitment 6).
const NOW = new Date('2026-06-01T00:00:00.000Z')
const NOW_SEC = Math.floor(NOW.getTime() / 1000)
const clock: Clock = { now: () => NOW }

interface KeyPairFixture {
  kid: string
  privateKey: CryptoKey
  jwk: JWK
}

async function makeKey(kid: string): Promise<KeyPairFixture> {
  const { publicKey, privateKey } = await generateKeyPair('ES256')
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' }
  return { kid, privateKey, jwk }
}

interface MintOptions {
  issuer?: string
  iat?: number
  exp?: number
}

function mint(key: KeyPairFixture, opts: MintOptions = {}): Promise<string> {
  return new SignJWT({ memberships: [{ community_id: EXAMPLE_COMMUNITY_ID, role: 'member' }] })
    .setProtectedHeader({ alg: 'ES256', kid: key.kid })
    .setSubject(EXAMPLE_USER_ID)
    .setIssuer(opts.issuer ?? ACCESS_TOKEN_ISSUER)
    .setIssuedAt(opts.iat ?? NOW_SEC - 60)
    .setExpirationTime(opts.exp ?? NOW_SEC + 3600)
    .sign(key.privateKey)
}

/** A JwksClient double serving the given keys; counts fetches so rotation refetch is observable. */
function jwksServing(keys: JWK[]): JwksClient & { fetches: () => number } {
  let count = 0
  return {
    fetches: () => count,
    getJwks: async () => {
      count += 1
      return { status: 200, body: { keys }, contentType: 'application/json' }
    },
  }
}

/** Serves `first` keys until a refetch, then `rest` — models a key rotation between fetches. */
function jwksRotating(first: JWK[], rest: JWK[]): JwksClient & { fetches: () => number } {
  let count = 0
  return {
    fetches: () => count,
    getJwks: async () => {
      count += 1
      return {
        status: 200,
        body: { keys: count === 1 ? first : rest },
        contentType: 'application/json',
      }
    },
  }
}

let key1: KeyPairFixture
let key2: KeyPairFixture

beforeAll(async () => {
  key1 = await makeKey('key-1')
  key2 = await makeKey('key-2')
})

describe('createTokenVerifier', () => {
  it('verifies a valid ES256 token and returns its membership claims', async () => {
    const verifier = createTokenVerifier(jwksServing([key1.jwk]), clock)
    const claims = await verifier.verify(`Bearer ${await mint(key1)}`)
    expect(claims.sub).toBe(EXAMPLE_USER_ID)
    expect(claims.memberships[0]?.community_id).toBe(EXAMPLE_COMMUNITY_ID)
  })

  it('rejects a missing Authorization header with 401', async () => {
    const verifier = createTokenVerifier(jwksServing([key1.jwk]), clock)
    await expect(verifier.verify(undefined)).rejects.toMatchObject({ problem: { status: 401 } })
  })

  it('rejects a non-Bearer Authorization header with 401', async () => {
    const verifier = createTokenVerifier(jwksServing([key1.jwk]), clock)
    await expect(verifier.verify('Basic abc')).rejects.toMatchObject({ problem: { status: 401 } })
  })

  it('rejects a token signed by a different key (bad signature) with 401', async () => {
    // key2 signs but the JWKS only serves key1 under the SAME kid the token claims.
    const forged = await mint({ ...key2, kid: 'key-1' })
    const verifier = createTokenVerifier(jwksServing([key1.jwk]), clock)
    await expect(verifier.verify(`Bearer ${forged}`)).rejects.toMatchObject({
      problem: { status: 401 },
    })
  })

  it('rejects an expired token with 401 (expiry judged against the injected clock)', async () => {
    const expired = await mint(key1, { iat: NOW_SEC - 7200, exp: NOW_SEC - 3600 })
    const verifier = createTokenVerifier(jwksServing([key1.jwk]), clock)
    await expect(verifier.verify(`Bearer ${expired}`)).rejects.toMatchObject({
      problem: { status: 401 },
    })
  })

  it('rejects a token from the wrong issuer with 401', async () => {
    const token = await mint(key1, { issuer: 'https://evil.example/identity' })
    const verifier = createTokenVerifier(jwksServing([key1.jwk]), clock)
    await expect(verifier.verify(`Bearer ${token}`)).rejects.toMatchObject({
      problem: { status: 401 },
    })
  })

  it('rejects a token whose signing key was rotated out of the JWKS (session fixation: post-rotation reuse fails)', async () => {
    // The "fixed" session was signed by key1; by the time it is presented at the edge, identity has
    // rotated and retired key1 past its grace window, so the JWKS serves only key2. The verifier must
    // refuse the stale token (kid miss → one refetch → key1 still absent → 401), never fall open —
    // a token does not outlive the key that signed it.
    const stale = await mint(key1)
    const verifier = createTokenVerifier(jwksServing([key2.jwk]), clock)
    await expect(verifier.verify(`Bearer ${stale}`)).rejects.toMatchObject({
      problem: { status: 401, failure_domain: 'authentication' },
    })
  })

  it('refetches the JWKS once on a kid miss (key rotation) and then verifies', async () => {
    // Fetch #1 serves only key-1 (priming the cache); after rotation the JWKS serves key-1 + key-2.
    const rotating = jwksRotating([key1.jwk], [key1.jwk, key2.jwk])
    const verifier = createTokenVerifier(rotating, clock)
    await verifier.verify(`Bearer ${await mint(key1)}`) // fetch #1, caches key-1 only
    const claims = await verifier.verify(`Bearer ${await mint(key2)}`) // kid miss → fetch #2 → ok
    expect(claims.sub).toBe(EXAMPLE_USER_ID)
    expect(rotating.fetches()).toBe(2)
  })
})

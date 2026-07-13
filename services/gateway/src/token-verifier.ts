import { ACCESS_TOKEN_ISSUER, AccessTokenClaims } from '@qaroom/contracts'
import type { Clock } from '@qaroom/determinism'
import { problem } from '@qaroom/service-kit'
import { createLocalJWKSet, jwtVerify } from 'jose'
import type { JwksClient } from './clients/jwks-client'

/**
 * The gateway's edge token verifier (ADR-0025, superseding ADR-0022's "the gateway never decodes
 * tokens"). Verifies an `Authorization: Bearer <jwt>` ES256 access token against identity's JWKS and
 * returns its claims (notably `memberships`), so a REST route can enforce community membership the
 * way the WS upgrade already does. Unlike the one-use WS ticket, a JWT is reusable, so it fits
 * repeated polling.
 *
 * Crypto-only seam: it consumes JWKS through the SAME bounded-timeout `JwksClient` (the Pact consumer
 * for the identity-issuance boundary) — never a raw fetch — then verifies LOCALLY with jose, so a
 * verified poll costs no per-request round-trip to identity. The parsed JWKS is cached; a token
 * signed by a rotated key (kid miss) triggers exactly one refetch-and-retry before it is rejected.
 */
export interface TokenVerifier {
  /** Verify a bearer `Authorization` header → claims, or throw an RFC 7807 ProblemError (401). */
  verify(authorization: string | undefined): Promise<AccessTokenClaims>
}

const BEARER = /^Bearer (.+)$/
type KeyResolver = ReturnType<typeof createLocalJWKSet>

function authProblem(slug: string, detail: string) {
  return problem({
    slug,
    title: 'Authentication failed',
    status: 401,
    failure_domain: 'authentication',
    detail,
    retryable: false,
  })
}

/** jose raises this code when no JWKS key matches the token's kid — i.e. the cache is stale. */
function isKidMiss(err: unknown): boolean {
  return (err as { code?: string }).code === 'ERR_JWKS_NO_MATCHING_KEY'
}

export function createTokenVerifier(jwks: JwksClient, clock: Clock): TokenVerifier {
  let resolver: KeyResolver | null = null

  async function loadJwks(): Promise<KeyResolver> {
    const res = await jwks.getJwks()
    if (res.status !== 200 || typeof res.body !== 'object' || res.body === null) {
      // Identity's JWKS is unreachable/garbage — our fault to surface, the client's to retry.
      throw problem({
        slug: 'jwks-unavailable',
        title: 'Verification keys unavailable',
        status: 503,
        failure_domain: 'dependency_failure',
        detail: 'Could not load identity verification keys; retry shortly.',
        retryable: true,
      })
    }
    resolver = createLocalJWKSet(res.body as Parameters<typeof createLocalJWKSet>[0])
    return resolver
  }

  return {
    async verify(authorization) {
      const token = authorization?.match(BEARER)?.[1]
      if (!token) {
        throw authProblem(
          'token-missing',
          'Present the access token as `Authorization: Bearer <jwt>`.',
        )
      }
      const options = {
        issuer: ACCESS_TOKEN_ISSUER,
        algorithms: ['ES256'],
        currentDate: clock.now(),
      }
      const keys = resolver ?? (await loadJwks())
      try {
        const { payload } = await jwtVerify(token, keys, options)
        return AccessTokenClaims.parse(payload)
      } catch (err) {
        // A kid miss means the signing key rotated since we cached: refetch once and retry before
        // declaring the token invalid. Any other failure (bad signature, expired, wrong issuer,
        // malformed claims) is a real rejection.
        if (isKidMiss(err)) {
          try {
            const fresh = await loadJwks()
            const { payload } = await jwtVerify(token, fresh, options)
            return AccessTokenClaims.parse(payload)
          } catch {
            throw authProblem(
              'token-invalid',
              'The token signature or claims are invalid or expired.',
            )
          }
        }
        throw authProblem('token-invalid', 'The token signature or claims are invalid or expired.')
      }
    },
  }
}

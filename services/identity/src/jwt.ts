import { AccessTokenClaims, type MembershipClaim, type UserId } from '@qaroom/contracts'
import { type Clock, unixSeconds } from '@qaroom/determinism'
import { problem } from '@qaroom/service-kit'
import { decodeProtectedHeader, importJWK, jwtVerify, SignJWT } from 'jose'
import type { KeyStore } from './keys'

/** Token issuer identity. Tokens are validated against this `iss`. */
export const ISSUER = 'https://qaroom.dev/identity'

export interface IssueInput {
  sub: UserId
  memberships: MembershipClaim[]
}

export interface IssuedToken {
  token: string
  kid: string
  /** Expiry as Unix seconds (JWT NumericDate). */
  exp: number
}

export interface Issuer {
  issue(input: IssueInput): Promise<IssuedToken>
  verify(token: string): Promise<AccessTokenClaims>
}

/** Every JWT rejection is a 401 in the authentication failure domain (Commitment 13). */
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

/**
 * The ES256 token issuer/verifier (ADR-0008). `iat`/`exp` and the verifier's expiry check
 * are driven by the injected logical Clock — never wall-clock — so expiry is deterministically
 * testable by advancing a FakeClock. Verification rejects (a) an undecodable header, (b) a kid
 * absent from the JWKS-eligible set, and (c) a bad signature / expired token / malformed claims.
 */
export function createIssuer(keyStore: KeyStore, clock: Clock, tokenTtlSeconds: number): Issuer {
  return {
    async issue({ sub, memberships }) {
      const key = await keyStore.current()
      const nowSec = unixSeconds(clock)
      const exp = nowSec + tokenTtlSeconds
      const privateKey = await importJWK(key.privateJwk, 'ES256')
      const token = await new SignJWT({ memberships })
        .setProtectedHeader({ alg: 'ES256', kid: key.kid })
        .setSubject(sub)
        .setIssuer(ISSUER)
        .setIssuedAt(nowSec)
        .setExpirationTime(exp)
        .sign(privateKey)
      return { token, kid: key.kid, exp }
    },

    async verify(token) {
      let kid: string | undefined
      try {
        kid = decodeProtectedHeader(token).kid
      } catch {
        throw authProblem('token-malformed', 'The token header could not be decoded.')
      }
      const key = await keyStore.verifyKeyFor(kid)
      if (!key) {
        throw authProblem('token-unknown-key', 'The token kid is not in the active JWKS.')
      }
      try {
        const publicKey = await importJWK(key.publicJwk, 'ES256')
        const { payload } = await jwtVerify(token, publicKey, {
          issuer: ISSUER,
          algorithms: ['ES256'],
          currentDate: clock.now(),
        })
        return AccessTokenClaims.parse(payload)
      } catch {
        throw authProblem('token-invalid', 'The token signature or claims are invalid or expired.')
      }
    },
  }
}

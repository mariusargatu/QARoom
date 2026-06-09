import { AccessTokenClaims } from '@qaroom/contracts'

/**
 * Decode (NOT verify) the JWT payload to read `sub` + `memberships` for navigation. This is
 * deliberately unverified: the gateway REST plane is unauthenticated by design (ADR-0022), so the
 * claims drive UI only and are never a trust boundary. Signature verification would need the JWKS;
 * it buys nothing here.
 */
export function decodeAccessTokenClaims(token: string): AccessTokenClaims | null {
  const raw = token.split('.')[1]
  if (!raw) return null
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '==='.slice((b64.length + 3) % 4)
    const parsed = AccessTokenClaims.safeParse(JSON.parse(atob(padded)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

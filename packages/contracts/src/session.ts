import { z } from 'zod'
import { Role } from './community'
import { CommunityId, SessionId, UserId } from './ids'

/**
 * JWT / JWKS contracts (Milestone 2, identity issuance boundary). ES256 only.
 * The `kid` lives in the JOSE protected header, not the payload. `exp`/`iat` are
 * Unix seconds (JWT NumericDate), computed from the injected Clock — never wall-clock.
 */

/**
 * The access-token issuer (JWT `iss`). ONE definition, derived everywhere: identity signs with it,
 * the gateway edge verifies against it (ADR-0025). A token whose `iss` differs is rejected.
 */
export const ACCESS_TOKEN_ISSUER = 'https://qaroom.dev/identity'

/** One membership entry as carried in the JWT `memberships` claim. */
export const MembershipClaim = z
  .object({ community_id: CommunityId, role: Role })
  .meta({ id: 'MembershipClaim', description: 'A {community_id, role} pair in the access token.' })
export type MembershipClaim = z.infer<typeof MembershipClaim>

/** Decoded ES256 access-token payload. */
export const AccessTokenClaims = z
  .object({
    sub: UserId,
    iss: z.string(),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().nonnegative(),
    memberships: z.array(MembershipClaim),
  })
  .meta({
    id: 'AccessTokenClaims',
    description: 'Decoded ES256 access-token payload (kid is in the JOSE header).',
  })
export type AccessTokenClaims = z.infer<typeof AccessTokenClaims>

/** Request body for createSession (issue an access token). */
export const CreateSessionRequest = z
  .strictObject({ user_id: UserId })
  .meta({ id: 'CreateSessionRequest', description: 'Body for createSession.' })
export type CreateSessionRequest = z.infer<typeof CreateSessionRequest>

/** Response from createSession: the compact JWS plus the signing kid that produced it. */
export const AccessTokenResponse = z
  .object({
    session_id: SessionId,
    access_token: z.string(),
    token_type: z.literal('Bearer'),
    expires_at: z.iso.datetime(),
    kid: z.string(),
  })
  .meta({ id: 'AccessTokenResponse', description: 'Issued access token and its signing kid.' })
export type AccessTokenResponse = z.infer<typeof AccessTokenResponse>

/**
 * A public EC P-256 JWK (RFC 7517) for ES256 verification. `.strict()` is load-bearing:
 * it guarantees a private `d` (or any other field) cannot ride along into the published
 * JWKS — a private key in the key set would be a catastrophic leak.
 */
export const Jwk = z
  .strictObject({
    kty: z.literal('EC'),
    crv: z.literal('P-256'),
    x: z.string(),
    y: z.string(),
    kid: z.string(),
    use: z.literal('sig'),
    alg: z.literal('ES256'),
  })
  .meta({ id: 'Jwk', description: 'Public EC P-256 JWK for ES256 verification.' })
export type Jwk = z.infer<typeof Jwk>

/** A JSON Web Key Set: the JWKS-eligible public keys (current + in-grace previous). */
export const Jwks = z
  .object({ keys: z.array(Jwk) })
  .meta({ id: 'Jwks', description: 'JSON Web Key Set: the JWKS-eligible public keys.' })
export type Jwks = z.infer<typeof Jwks>

import type { AccessTokenClaims } from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'
import { decodeAccessTokenClaims } from './jwt'

// The function decodes (never verifies) the JWT payload, so the signature segment is
// arbitrary. We forge a `header.payload.sig` compact form where only the middle segment
// matters, base64url-encoding the JSON exactly as a real issuer would.
const encodeSegment = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')

const forgeToken = (payload: unknown): string =>
  [encodeSegment({ alg: 'ES256', kid: 'key_x' }), encodeSegment(payload), 'sig'].join('.')

// A claims object that satisfies AccessTokenClaims: branded `user_`/`comm_` ULID ids,
// integer Unix-second iat/exp, and one membership pair.
const ownerMembership = { community_id: 'comm_0000000000000000000000000B', role: 'owner' } as const
const validClaims = {
  sub: 'user_0000000000000000000000000A',
  iss: 'https://identity.qaroom.localhost',
  iat: 1_700_000_000,
  exp: 1_700_003_600,
  memberships: [ownerMembership],
} satisfies AccessTokenClaims

describe('decodeAccessTokenClaims', () => {
  it('decodes a valid base64url JWT payload into its parsed claims', () => {
    const result = decodeAccessTokenClaims(forgeToken(validClaims))
    expect(result).toEqual(validClaims)
  })

  it('preserves every membership entry carried in the decoded payload', () => {
    const result = decodeAccessTokenClaims(forgeToken(validClaims))
    expect(result?.memberships).toEqual(validClaims.memberships)
  })

  it('returns null for a garbage non-JWT string with no payload segment', () => {
    expect(decodeAccessTokenClaims('not-a-jwt')).toBeNull()
  })

  it('returns null when the payload segment decodes to non-JSON text', () => {
    const token = ['hdr', Buffer.from('}{not json', 'utf8').toString('base64url'), 'sig'].join('.')
    expect(decodeAccessTokenClaims(token)).toBeNull()
  })

  it('returns null when the payload is valid JSON but fails the claims schema', () => {
    const token = forgeToken({ sub: 'not-a-user-id', iss: 'x' })
    expect(decodeAccessTokenClaims(token)).toBeNull()
  })

  it('returns null when a membership carries a role outside the Role enum', () => {
    const token = forgeToken({
      ...validClaims,
      memberships: [{ community_id: ownerMembership.community_id, role: 'admin' }],
    })
    expect(decodeAccessTokenClaims(token)).toBeNull()
  })

  it('returns null when an empty string is supplied as the token', () => {
    expect(decodeAccessTokenClaims('')).toBeNull()
  })
})

import { communityIdArb, roleArb, userIdArb } from '@qaroom/testing-utils/generators'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { decodeAccessTokenClaims } from './jwt'

// Property tests for the pure `decodeAccessTokenClaims` (ADR-0005). It base64url-decodes the JWT
// payload and validates it against the AccessTokenClaims schema — no signature check (ADR-0022),
// no DOM/fetch. The example-based `jwt.test.ts` pins concrete tokens; these pin the laws: any valid
// claims object survives the forge -> decode round trip unchanged, and the decoder is total (never
// throws, returns null on anything it cannot read). Node env. The branded-id / role arbitraries are
// the repo's shared generators (@qaroom/testing-utils/generators), not re-rolled here.

// `iss` is a free-form string in the schema, but the decoder reads it through `atob` (Latin1), so
// the round trip is only byte-exact for single-byte text. Restrict to printable ASCII — the form a
// real issuer URL takes — so the round-trip law is about the decoder, not a UTF-8/Latin1 mismatch.
const asciiStringArb = fc
  .array(
    fc.integer({ min: 32, max: 126 }).map((code) => String.fromCharCode(code)),
    {
      maxLength: 40,
    },
  )
  .map((chars) => chars.join(''))

const claimsArb = fc.record({
  sub: userIdArb,
  iss: asciiStringArb,
  iat: fc.nat(),
  exp: fc.nat(),
  memberships: fc.array(fc.record({ community_id: communityIdArb, role: roleArb }), {
    maxLength: 4,
  }),
})

// Base64url-encode the payload exactly as an issuer would, then forge a `header.payload.sig`
// compact JWS whose only meaningful segment is the middle one (the decoder never verifies).
const forge = (payload: unknown): string =>
  ['hdr', Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'), 'sig'].join('.')

describe('decodeAccessTokenClaims invariants', () => {
  it('round-trips any valid claims object through forge then decode unchanged', () => {
    fc.assert(
      fc.property(claimsArb, (claims) => {
        expect(decodeAccessTokenClaims(forge(claims))).toEqual(claims)
      }),
    )
  })

  it('preserves every membership entry across the encode-decode round trip', () => {
    fc.assert(
      fc.property(claimsArb, (claims) => {
        expect(decodeAccessTokenClaims(forge(claims))?.memberships).toEqual(claims.memberships)
      }),
    )
  })

  it('is total: it never throws for any arbitrary token string', () => {
    fc.assert(
      fc.property(fc.string(), (token) => {
        expect(() => decodeAccessTokenClaims(token)).not.toThrow()
      }),
    )
  })

  it('returns null for any string that has no payload-segment delimiter', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !s.includes('.')),
        (token) => {
          expect(decodeAccessTokenClaims(token)).toBeNull()
        },
      ),
    )
  })
})

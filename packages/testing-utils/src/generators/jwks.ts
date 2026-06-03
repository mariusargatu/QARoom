import fc from 'fast-check'
import { keyIdArb } from './identity'

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.split('')
/** A non-empty base64url string (the shape of an EC coordinate; the JWK schema only requires a string). */
const base64UrlArb = fc
  .array(fc.constantFrom(...BASE64URL), { minLength: 1, maxLength: 43 })
  .map((chars) => chars.join(''))

/** Arbitrary public EC P-256 JWK matching the `Jwk` contract (exactly its fields — `.strict()`). */
export const jwkArb = fc.record({
  kty: fc.constant('EC'),
  crv: fc.constant('P-256'),
  x: base64UrlArb,
  y: base64UrlArb,
  kid: keyIdArb,
  use: fc.constant('sig'),
  alg: fc.constant('ES256'),
})

/** Arbitrary JSON Web Key Set. */
export const jwksArb = fc.record({ keys: fc.array(jwkArb, { maxLength: 3 }) })

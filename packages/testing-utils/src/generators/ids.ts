import fc from 'fast-check'

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'.split('')

/** A 26-char Crockford base32 body — the ULID portion of a branded id. */
export const ulidArb = fc
  .array(fc.constantFrom(...CROCKFORD), { minLength: 26, maxLength: 26 })
  .map((chars) => chars.join(''))

export const userIdArb = ulidArb.map((u) => `user_${u}`)
// UUID keeps the value safe as an HTTP header (no control chars / newlines).
export const idempotencyKeyArb = fc.uuid()

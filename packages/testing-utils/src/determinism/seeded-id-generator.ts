import type { IdGenerator } from '@qaroom/determinism'

/** Crockford base32 alphabet (excludes I, L, O, U) — matches the branded-ID regex. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Encode a value into exactly 26 Crockford base32 chars (130 bits, MSB first). */
function encode26(value: bigint): string {
  let v = value & ((1n << 130n) - 1n)
  const out: string[] = new Array(26)
  for (let i = 25; i >= 0; i--) {
    out[i] = CROCKFORD[Number(v & 31n)] ?? '0'
    v >>= 5n
  }
  return out.join('')
}

/**
 * Seeded test IdGenerator producing deterministic `<prefix>_<ULID-shaped>` ids.
 * The same seed yields the same monotonic sequence, so ids are predictable and
 * reproducible across runs. The body is real Crockford base32, so the values
 * satisfy the branded-ID parsers in `@qaroom/contracts`.
 */
export class SeededIdGenerator implements IdGenerator {
  readonly #seedHigh: bigint
  #counter = 0n

  constructor(seed = 1) {
    this.#seedHigh = BigInt(seed) << 80n
  }

  next(prefix: string): string {
    this.#counter += 1n
    return `${prefix}_${encode26(this.#seedHigh | this.#counter)}`
  }
}

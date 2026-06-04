// Branded-id helpers for k6 scripts (goja, no TS import). Mirrors packages/contracts/src/ids.ts:
// `<prefix>_<26 Crockford base32 chars>`. n=0 yields the 26-zero id (e.g. COMM_GENERAL).
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function brandedId(prefix, n) {
  let out = ''
  let x = Math.max(0, Math.floor(n))
  do {
    out = CROCKFORD[x % 32] + out
    x = Math.floor(x / 32)
  } while (x > 0)
  return `${prefix}_${out.padStart(26, '0')}`
}

// The well-known default community ("general") — comm_ + 26 zeros (packages/contracts COMM_GENERAL).
export const COMM_GENERAL = brandedId('comm', 0)

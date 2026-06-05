import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Randomness } from '@qaroom/determinism'

/**
 * Webhook payload signing (Milestone 11, ADR-0019). Each delivery is signed so the receiver can
 * verify it came from QARoom and was not tampered with or replayed. Scheme (Stripe-style `v1`):
 * the signed string is `timestamp + '.' + body`, HMAC-SHA256 under the subscription's secret, hex
 * encoded. Binding the timestamp INTO the signature (not just sending it alongside) is what closes
 * the replay window — a captured `(body, signature)` pair cannot be replayed with a fresh timestamp.
 *
 * Signing is deterministic (no clock, no randomness) so it is trivially property-testable; the only
 * randomness is in minting the secret, which draws from the injected `Randomness` (Commitment 6 —
 * never `crypto.randomBytes`/`Math.random` in business code; production wires a CSPRNG-backed
 * `Randomness`, so the secret is still cryptographically strong, while tests can seed it).
 */

export const WEBHOOK_SIGNATURE_HEADER = 'X-QARoom-Signature'
export const WEBHOOK_TIMESTAMP_HEADER = 'X-QARoom-Timestamp'
export const WEBHOOK_DELIVERY_ID_HEADER = 'X-QARoom-Delivery-Id'
export const WEBHOOK_EVENT_ID_HEADER = 'X-QARoom-Event-Id'

/** HMAC-SHA256 signature scheme advertised to subscribers via `/system/capabilities`. */
export const WEBHOOK_SIGNATURE_SCHEME = {
  algorithm: 'HMAC-SHA256',
  signature_header: WEBHOOK_SIGNATURE_HEADER,
  timestamp_header: WEBHOOK_TIMESTAMP_HEADER,
  format: 'v1=hex(hmac_sha256(secret, `${timestamp}.${body}`))',
} as const

/** The exact bytes signed: `timestamp + '.' + body`. The timestamp binding defeats replay. */
export function webhookSigningInput(timestamp: string, body: string): string {
  return `${timestamp}.${body}`
}

/** Compute the `X-QARoom-Signature` value (`v1=<hex>`) for a delivery. */
export function signWebhook(secret: string, timestamp: string, body: string): string {
  const mac = createHmac('sha256', secret)
    .update(webhookSigningInput(timestamp, body))
    .digest('hex')
  return `v1=${mac}`
}

/**
 * Constant-time verification of a delivery signature. The receiver-side oracle the signature
 * property test exercises. Returns false on any tamper (body, timestamp, or signature) and never
 * throws. `toleranceSeconds`, when given with `now`, rejects timestamps outside the freshness
 * window (replay defense) even if the HMAC matches.
 */
export function verifyWebhook(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
  opts?: { now?: Date; toleranceSeconds?: number },
): boolean {
  if (opts?.now && opts.toleranceSeconds !== undefined) {
    const sent = Date.parse(timestamp)
    if (Number.isNaN(sent)) return false
    const skewMs = Math.abs(opts.now.getTime() - sent)
    if (skewMs > opts.toleranceSeconds * 1000) return false
  }
  const expected = Buffer.from(signWebhook(secret, timestamp, body))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

/**
 * Mint a subscription signing secret (`whsec_<64 hex chars>` = 32 bytes) from injected
 * `Randomness`. Seedable in tests; CSPRNG-strong in production.
 */
export function generateWebhookSecret(randomness: Randomness): string {
  let hex = ''
  for (let i = 0; i < 32; i += 1) {
    hex += randomness.int(0, 255).toString(16).padStart(2, '0')
  }
  return `whsec_${hex}`
}

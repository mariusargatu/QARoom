import type { Randomness } from '@qaroom/determinism'

/**
 * Webhook payload signing (Milestone 11, ADR-0019) — the BROWSER-SAFE half: header names, the
 * advertised scheme, the signed-input builder, and secret minting (injected `Randomness`, no
 * `node:crypto`). The HMAC-SHA256 sign/verify live in `./webhook-hmac` (Node-only) so this module —
 * re-exported from the `@qaroom/contracts` barrel the web frontend imports — never drags `node:crypto`
 * into the client bundle. Scheme (Stripe-style `v1`): the signed string is `timestamp + '.' + body`,
 * HMAC-SHA256 under the subscription's secret, hex encoded; binding the timestamp IN closes the
 * replay window.
 *
 * Secret minting draws from the injected `Randomness` (Commitment 6 — never
 * `crypto.randomBytes`/`Math.random` in business code; production wires a CSPRNG-backed `Randomness`,
 * so the secret is still cryptographically strong, while tests can seed it).
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

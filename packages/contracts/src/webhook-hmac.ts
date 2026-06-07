import { createHmac, timingSafeEqual } from 'node:crypto'
import { webhookSigningInput } from './webhook-signing'

/**
 * The Node-only half of webhook signing (Milestone 11, ADR-0019): the HMAC-SHA256 sign/verify that
 * depend on `node:crypto`. Split out of `./webhook-signing` so the BROWSER-reachable barrel
 * (`@qaroom/contracts`) — which the web frontend imports — never pulls `node:crypto` into the client
 * bundle. Server-only consumers (the webhooks worker, the signing tests) import it via the
 * `@qaroom/contracts/webhook-hmac` subpath. The browser-safe constants + `webhookSigningInput` +
 * `generateWebhookSecret` stay in `./webhook-signing`.
 *
 * Scheme (Stripe-style `v1`): signed string is `timestamp + '.' + body`, HMAC-SHA256 under the
 * subscription secret, hex encoded — the timestamp is bound IN so a captured pair can't be replayed.
 */

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

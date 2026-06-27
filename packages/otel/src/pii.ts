/**
 * The single source for "what counts as PII in a span" (ADR-0034). Both the in-process PII-in-spans
 * gate (the `pii-free-spans` claim's teeth) and the live Tier-B Jaeger sweep
 * (`scripts/check-pii-spans.ts`) scan span attributes through THIS detector, so the offline gate and
 * the live audit can never disagree on the rule. Commitment 9 already pins `tenant.id` onto every
 * span; this pins the inverse — that nothing email-shaped or body-shaped ever rides along.
 *
 * Pure string/shape predicates, no I/O: spans carry route/tenant/status metadata, never user PII.
 */

/** Email-shaped value — a common accidental leak (a user's address logged onto a span attribute). */
export const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i

/**
 * Attribute KEYS that must never appear on a span: free-text user content (post/comment/message
 * bodies) and direct identifiers. A span describing a request carries its route and status, never the
 * payload. `tenant.id` (the community discriminator, Commitment 9) is deliberately NOT here — it is a
 * tenancy key, not PII.
 */
export const PII_ATTR_DENYLIST: readonly string[] = [
  'email',
  'user.email',
  'user.name',
  'user.phone',
  'phone',
  'post.body',
  'comment.body',
  'message.body',
  'content.body',
  'http.request.body',
]

/** A single attribute value is PII when it is a string that looks like an email. */
export function valueLooksLikePii(value: unknown): boolean {
  return typeof value === 'string' && EMAIL_RE.test(value)
}

/** An attribute leaks PII when its key is denied, or its value is email-shaped (whatever the key). */
export function attributeLeaksPii(key: string, value: unknown): boolean {
  return PII_ATTR_DENYLIST.includes(key) || valueLooksLikePii(value)
}

/**
 * Return the offending attribute keys (sorted, deduped) — empty when the span is PII-free. Accepts
 * the flat `Record<string, AttributeValue>` an OTel `ReadableSpan` exposes, or the same shape built
 * from Jaeger tags in the live sweep.
 */
export function findPiiInAttributes(attrs: Record<string, unknown>): string[] {
  return Object.entries(attrs)
    .filter(([key, value]) => attributeLeaksPii(key, value))
    .map(([key]) => key)
    .sort()
}

let counter = 0

/**
 * A unique, deterministic Idempotency-Key for a test mutation — a monotonic counter, NOT a
 * random UUID, so a test run is reproducible. Shared by every service harness so the "one key
 * per request" helper lives in one place. The optional prefix keeps keys legible per service.
 */
export function nextIdempotencyKey(prefix = 'idem'): string {
  counter += 1
  return `${prefix}-test-key-${counter}`
}

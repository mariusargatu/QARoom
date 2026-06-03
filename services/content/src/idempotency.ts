import { createHash } from 'node:crypto'

/**
 * Stable JSON serialization: object keys sorted recursively so the same logical
 * body always hashes identically regardless of client key order. Used to key the
 * `idempotency_responses` table (Commitment 4).
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

/** SHA-256 of the stable-serialized body. Deterministic, not random. */
export function bodyHash(body: unknown): string {
  return createHash('sha256').update(stableStringify(body)).digest('hex')
}

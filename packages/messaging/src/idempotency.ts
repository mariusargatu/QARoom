import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { rowsOf, type SqlExecutor } from './types'

// Re-exported so consumers (service-kit's withIdempotency) get the type from this
// NATS-free subpath (`@qaroom/messaging/idempotency`) without importing the broker client.
export type { SqlExecutor } from './types'

/**
 * Idempotency-Key replay store (Commitment 4), shared so content + identity stop carrying
 * byte-identical copies. The `idempotency_responses` table this reads/writes is the same
 * shape every service applies via `idempotencyResponsesMigration`. Raw `sql` over
 * `SqlExecutor` (the SDK's cross-driver seam), so it works on postgres-js and pglite alike.
 */

/**
 * Stable JSON serialization: object keys sorted recursively, so the same logical body
 * always hashes identically regardless of client key order.
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

export interface StoredResponse {
  status: number
  body: unknown
}

/** Return the stored response for an exact `(key, route, bodyHash)` replay, or null. */
export async function findIdempotent(
  tx: SqlExecutor,
  key: string,
  route: string,
  hash: string,
): Promise<StoredResponse | null> {
  const res = await tx.execute(
    sql`SELECT status, response_body FROM idempotency_responses WHERE idempotency_key = ${key} AND route = ${route} AND body_hash = ${hash} LIMIT 1`,
  )
  const row = rowsOf<{ status: number; response_body: unknown }>(res)[0]
  return row ? { status: row.status, body: row.response_body } : null
}

/**
 * Has `(key, route)` already been used with a DIFFERENT body? A true here means the caller
 * reused an Idempotency-Key for a different request → 409 conflict (conventions §3).
 */
export async function conflictingIdempotencyKey(
  tx: SqlExecutor,
  key: string,
  route: string,
  hash: string,
): Promise<boolean> {
  const res = await tx.execute(
    sql`SELECT 1 AS one FROM idempotency_responses WHERE idempotency_key = ${key} AND route = ${route} AND body_hash <> ${hash} LIMIT 1`,
  )
  return rowsOf(res).length > 0
}

/** Persist a response for replay. `ON CONFLICT DO NOTHING` keeps concurrent first-writers safe. */
export async function storeIdempotent(
  tx: SqlExecutor,
  record: { key: string; route: string; hash: string; status: number; body: unknown },
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`INSERT INTO idempotency_responses (idempotency_key, route, body_hash, status, response_body, created_at)
        VALUES (${record.key}, ${record.route}, ${record.hash}, ${record.status}, ${JSON.stringify(record.body)}::jsonb, ${now.toISOString()}::timestamptz)
        ON CONFLICT DO NOTHING`,
  )
}

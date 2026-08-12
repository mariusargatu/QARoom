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

/**
 * Status sentinel for a CLAIMED-but-not-yet-finished request. A real response status is always a
 * valid HTTP code, so 0 cannot collide with one.
 *
 * The claim row is what makes the replay store concurrency-safe. Before 2026-08-12 the flow was
 * check → produce → store, with `ON CONFLICT DO NOTHING` on the store: two requests carrying the
 * same key both missed the check, both ran the effect, and the second insert was silently swallowed
 * instead of stopping anything. Ten concurrent same-key requests against a live content-service on
 * real Postgres produced EIGHT posts and eight outbox events, all answered 201 — the retry boundary
 * (Commitment 4) failing in the most common real retry scenario there is, a client timing out and
 * retrying while its first request is still in flight.
 *
 * Now the INSERT comes FIRST and is the arbiter: exactly one caller can create the row, so exactly
 * one caller runs the effect. The rest either replay the winner's stored response or are told the
 * request is in progress.
 */
export const IDEMPOTENCY_IN_FLIGHT = 0

/**
 * How long a claim may sit unfinished before another caller may take it over. A process that dies
 * between claiming and completing would otherwise wedge that key until `gcDedup`'s much longer
 * sweep. Takeover is a conditional UPDATE, so only one reclaimer can win.
 */
export const IDEMPOTENCY_CLAIM_STALE_MS = 60_000

/**
 * Return the stored response for an exact `(key, route, bodyHash)` replay, or null.
 *
 * Ignores in-flight claims: a claim is a reservation, not a response, and returning its sentinel
 * would replay `status: 0` to the caller as though the request had completed.
 */
export async function findIdempotent(
  tx: SqlExecutor,
  key: string,
  route: string,
  hash: string,
): Promise<StoredResponse | null> {
  const res = await tx.execute(
    sql`SELECT status, response_body FROM idempotency_responses WHERE idempotency_key = ${key} AND route = ${route} AND body_hash = ${hash} AND status <> ${IDEMPOTENCY_IN_FLIGHT} LIMIT 1`,
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

/** What a claim attempt found. Only `claimed` may run the guarded effect. */
export type ClaimOutcome = 'claimed' | 'in_flight' | 'completed'

/**
 * Reserve `(key, route, hash)` for exactly one caller.
 *
 * The INSERT is the mutual exclusion: the primary key admits one winner and the losers get zero
 * rows back, with no lock held across the caller's work and no extra connection needed (holding a
 * transaction open across `produce` would deadlock a pool once more than `PG_POOL_MAX` callers
 * queued on the same key).
 *
 * A claim older than {@link IDEMPOTENCY_CLAIM_STALE_MS} is taken over rather than honoured — the
 * previous owner died. The takeover is itself a conditional UPDATE, so two reclaimers cannot both
 * win it.
 */
export async function claimIdempotent(
  tx: SqlExecutor,
  record: { key: string; route: string; hash: string },
  now: Date,
  staleAfterMs: number = IDEMPOTENCY_CLAIM_STALE_MS,
): Promise<ClaimOutcome> {
  const iso = now.toISOString()
  const inserted = await tx.execute(
    sql`INSERT INTO idempotency_responses (idempotency_key, route, body_hash, status, response_body, created_at)
        VALUES (${record.key}, ${record.route}, ${record.hash}, ${IDEMPOTENCY_IN_FLIGHT}, 'null'::jsonb, ${iso}::timestamptz)
        ON CONFLICT (idempotency_key, route, body_hash) DO NOTHING
        RETURNING 1 AS one`,
  )
  if (rowsOf(inserted).length > 0) return 'claimed'

  const existing = await tx.execute(
    sql`SELECT status FROM idempotency_responses WHERE idempotency_key = ${record.key} AND route = ${record.route} AND body_hash = ${record.hash} LIMIT 1`,
  )
  const row = rowsOf<{ status: number }>(existing)[0]
  // Vanished between the two statements (a concurrent release or GC sweep) — treat as free and let
  // the caller retry the claim rather than reporting a completion that does not exist.
  if (!row) return 'in_flight'
  if (row.status !== IDEMPOTENCY_IN_FLIGHT) return 'completed'

  const seconds = staleAfterMs / 1000
  const takeover = await tx.execute(
    sql`UPDATE idempotency_responses SET created_at = ${iso}::timestamptz
        WHERE idempotency_key = ${record.key} AND route = ${record.route} AND body_hash = ${record.hash}
          AND status = ${IDEMPOTENCY_IN_FLIGHT}
          AND created_at < (${iso}::timestamptz - make_interval(secs => ${seconds}))
        RETURNING 1 AS one`,
  )
  return rowsOf(takeover).length > 0 ? 'claimed' : 'in_flight'
}

/** Finish a claim by writing the real response. Only the claim holder calls this. */
export async function completeIdempotent(
  tx: SqlExecutor,
  record: { key: string; route: string; hash: string; status: number; body: unknown },
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`UPDATE idempotency_responses
        SET status = ${record.status}, response_body = ${JSON.stringify(record.body)}::jsonb, created_at = ${now.toISOString()}::timestamptz
        WHERE idempotency_key = ${record.key} AND route = ${record.route} AND body_hash = ${record.hash}`,
  )
}

/**
 * Drop an unfinished claim so the key is usable again. Called when the guarded effect throws —
 * a failed request must not burn its Idempotency-Key until the stale window expires.
 *
 * Scoped to `status = IDEMPOTENCY_IN_FLIGHT` so it can never delete a completed response.
 */
export async function releaseIdempotent(
  tx: SqlExecutor,
  key: string,
  route: string,
  hash: string,
): Promise<void> {
  await tx.execute(
    sql`DELETE FROM idempotency_responses WHERE idempotency_key = ${key} AND route = ${route} AND body_hash = ${hash} AND status = ${IDEMPOTENCY_IN_FLIGHT}`,
  )
}

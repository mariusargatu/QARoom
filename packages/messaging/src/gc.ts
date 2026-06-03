import { sql } from 'drizzle-orm'
import { rowsOf, type SqlExecutor } from './types'

/**
 * Delete dedup-table rows older than `maxAgeMs` relative to `now` (the `jobs:gc-dedup` TTL
 * job). HYGIENE ONLY (Commitment 17): correctness rests on the `Nats-Msg-Id` duplicate
 * window plus the `processed_events` table, never on this running on time. The cutoff is
 * computed in SQL from the injected clock's `now`, so the job stays free of `new Date()`.
 * Returns how many rows each table shed.
 */
export async function gcDedup(
  db: SqlExecutor,
  now: Date,
  maxAgeMs: number,
): Promise<{ idempotencyResponses: number; processedEvents: number }> {
  const seconds = maxAgeMs / 1000
  const idempotency = rowsOf(
    await db.execute(
      sql`DELETE FROM idempotency_responses WHERE created_at < ${now.toISOString()}::timestamptz - make_interval(secs => ${seconds}) RETURNING idempotency_key`,
    ),
  )
  const processed = rowsOf(
    await db.execute(
      sql`DELETE FROM processed_events WHERE processed_at < ${now.toISOString()}::timestamptz - make_interval(secs => ${seconds}) RETURNING event_id`,
    ),
  )
  return { idempotencyResponses: idempotency.length, processedEvents: processed.length }
}

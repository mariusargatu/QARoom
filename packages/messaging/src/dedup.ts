import { sql } from 'drizzle-orm'
import { rowsOf, type SqlExecutor } from './types'

/**
 * Has `eventId` already been processed by `subscriptionName`? Serializes concurrent
 * deliveries of the SAME event with a transaction-scoped advisory lock (the single-writer
 * pattern, Commitment 4), so the check-then-insert cannot race two handlers into running.
 */
export async function alreadyProcessed(
  tx: SqlExecutor,
  subscriptionName: string,
  eventId: string,
): Promise<boolean> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${subscriptionName}:${eventId}`}, 0))`,
  )
  const res = await tx.execute(
    sql`SELECT 1 AS one FROM processed_events WHERE subscription_name = ${subscriptionName} AND event_id = ${eventId} LIMIT 1`,
  )
  return rowsOf(res).length > 0
}

/**
 * Record `eventId` as processed by `subscriptionName`, in the SAME transaction as the
 * handler's effects. Removing this call is the Milestone-4 dedup deliberate-bug: the
 * duplicate-delivery property then catches an observable double-effect.
 */
export async function markProcessed(
  tx: SqlExecutor,
  subscriptionName: string,
  eventId: string,
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`INSERT INTO processed_events (subscription_name, event_id, processed_at) VALUES (${subscriptionName}, ${eventId}, ${now.toISOString()}::timestamptz) ON CONFLICT DO NOTHING`,
  )
}

import { sql } from 'drizzle-orm'
import { rowsOf, type SqlExecutor } from './types'

/**
 * Which messaging-owned tables a given service actually has, so the same TTL sweep can run
 * against any service's Postgres and skip the tables it never migrated. Full adopters of
 * `messagingMigration` (content, donations, flags) set all three; pure consumers set only
 * what they have — webhooks has no `outbox` (it publishes nothing, ADR-0019), identity has
 * neither `outbox` nor `processed_events` (only the Idempotency-Key replay store).
 */
export interface GcTargets {
  outbox: boolean
  processedEvents: boolean
  idempotencyResponses: boolean
}

/** Rows shed per table this pass; a table the service does not have contributes 0. */
export interface GcSweep {
  outbox: number
  processedEvents: number
  idempotencyResponses: number
}

/**
 * The `jobs:gc-dedup` TTL sweep for the messaging substrate. Deletes rows older than
 * `maxAgeMs` relative to `now`: the dedup tables (`idempotency_responses`,
 * `processed_events`) AND aged *published* outbox rows. Published rows are already relayed,
 * so Commitment 17 keeps them only for audit — they are an unbounded leak until swept.
 * UNPUBLISHED outbox rows (`published_at IS NULL`) are NEVER touched: they are still pending
 * relay and deleting one would lose an event.
 *
 * HYGIENE ONLY (Commitment 17): correctness rests on the `Nats-Msg-Id` duplicate window plus
 * the `processed_events` table, never on this running on time. The cutoff is computed in SQL
 * from the injected clock's `now`, so the job stays free of `new Date()`. `targets` lets the
 * same code run DSN-parameterized against any service's Postgres. Returns rows shed per table.
 */
export async function gcDedup(
  db: SqlExecutor,
  now: Date,
  maxAgeMs: number,
  targets: GcTargets,
): Promise<GcSweep> {
  const seconds = maxAgeMs / 1000
  const cutoff = sql`${now.toISOString()}::timestamptz - make_interval(secs => ${seconds})`
  const outbox = targets.outbox
    ? rowsOf(
        await db.execute(
          sql`DELETE FROM outbox WHERE published_at IS NOT NULL AND published_at < (${cutoff}) RETURNING id`,
        ),
      ).length
    : 0
  const processedEvents = targets.processedEvents
    ? rowsOf(
        await db.execute(
          sql`DELETE FROM processed_events WHERE processed_at < (${cutoff}) RETURNING event_id`,
        ),
      ).length
    : 0
  const idempotencyResponses = targets.idempotencyResponses
    ? rowsOf(
        await db.execute(
          sql`DELETE FROM idempotency_responses WHERE created_at < (${cutoff}) RETURNING idempotency_key`,
        ),
      ).length
    : 0
  return { outbox, processedEvents, idempotencyResponses }
}

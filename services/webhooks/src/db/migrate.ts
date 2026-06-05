import { composeMigrations, type Migration } from '@qaroom/contracts'
import {
  idempotencyResponsesMigration,
  processedEventsMigration,
} from '@qaroom/messaging/migrations'
import { sql } from 'drizzle-orm'
import type { SqlExecutor } from './client'

/**
 * The webhooks-service domain tables, as reversible migrations so the up→down→up→up idempotency
 * test (docs/05 migration discipline) covers them. Each `up` is idempotent (`IF NOT EXISTS`); the
 * `down` drops in reverse.
 */
const subscriptionsMigration: Migration<SqlExecutor> = {
  name: 'webhook_subscriptions',
  async up(tx) {
    await tx.execute(
      sql.raw(`CREATE TABLE IF NOT EXISTS webhook_subscriptions (
        id text PRIMARY KEY,
        community_id text NOT NULL,
        url text NOT NULL,
        secret text NOT NULL,
        event_types text[] NOT NULL,
        status text NOT NULL,
        consecutive_dead_letters integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      )`),
    )
    // The fan-out reads active subscriptions by (community_id, status), so index both.
    await tx.execute(
      sql.raw(
        `CREATE INDEX IF NOT EXISTS webhook_subscriptions_community_status_idx ON webhook_subscriptions (community_id, status)`,
      ),
    )
  },
  async down(tx) {
    await tx.execute(sql.raw(`DROP TABLE IF EXISTS webhook_subscriptions`))
  },
}

const deliveriesMigration: Migration<SqlExecutor> = {
  name: 'webhook_deliveries',
  async up(tx) {
    await tx.execute(
      sql.raw(`CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id text PRIMARY KEY,
        subscription_id text NOT NULL,
        community_id text NOT NULL,
        event_id text NOT NULL,
        event_type text NOT NULL,
        payload jsonb NOT NULL,
        status text NOT NULL,
        attempt integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz,
        last_status_code integer,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      )`),
    )
    // The worker polls due, non-terminal rows by next_attempt_at.
    await tx.execute(
      sql.raw(
        `CREATE INDEX IF NOT EXISTS webhook_deliveries_due_idx ON webhook_deliveries (next_attempt_at)`,
      ),
    )
    // The per-target dedup boundary: one delivery per (subscription, event).
    await tx.execute(
      sql.raw(
        `CREATE UNIQUE INDEX IF NOT EXISTS webhook_deliveries_sub_event_idx ON webhook_deliveries (subscription_id, event_id)`,
      ),
    )
  },
  async down(tx) {
    await tx.execute(sql.raw(`DROP TABLE IF EXISTS webhook_deliveries`))
  },
}

/**
 * The full schema: domain tables + the messaging substrate. NO `outboxMigration` — webhooks
 * publishes nothing (recursion guard, ADR-0019). `processed_events` backs consumer dedup;
 * `idempotency_responses` backs CRUD Idempotency-Key replay.
 */
export const webhooksMigrations = composeMigrations<SqlExecutor>([
  subscriptionsMigration,
  deliveriesMigration,
  processedEventsMigration,
  idempotencyResponsesMigration,
])

/** Apply the webhooks-service schema. Idempotent; safe to call on every boot/test. */
export async function ensureSchema(db: SqlExecutor): Promise<void> {
  await webhooksMigrations.up(db)
}

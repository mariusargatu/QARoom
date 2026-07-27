import { composeMigrations, type Migration } from '@qaroom/contracts'
import { sql } from 'drizzle-orm'
import type { SqlExecutor } from './types'

/**
 * Reusable Drizzle migration fragments for the messaging substrate (Commitment 17 / 4).
 * Every service that adopts messaging applies these through its OWN pipeline
 * (`composeMigrations` / `ensureSchema`), so the dedup tables have one canonical shape.
 * Each fragment ships `up` and `down`; the idempotency test in `migrations.test.ts` pins
 * up → down → up → up convergence (docs/05 migration discipline).
 */

export const outboxMigration: Migration<SqlExecutor> = {
  name: 'create_outbox',
  async up(tx) {
    await tx.execute(
      sql.raw(`CREATE TABLE IF NOT EXISTS outbox (
        id text PRIMARY KEY,
        subject text NOT NULL,
        event_name text NOT NULL,
        event_version integer NOT NULL,
        community_id text NOT NULL,
        payload jsonb NOT NULL,
        trace_context jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        published_at timestamptz,
        attempts integer NOT NULL DEFAULT 0
      )`),
    )
    await tx.execute(
      sql.raw(
        'CREATE INDEX IF NOT EXISTS outbox_unpublished_idx ON outbox (created_at) WHERE published_at IS NULL',
      ),
    )
  },
  async down(tx) {
    await tx.execute(sql.raw('DROP TABLE IF EXISTS outbox'))
  },
}

export const processedEventsMigration: Migration<SqlExecutor> = {
  name: 'create_processed_events',
  async up(tx) {
    await tx.execute(
      sql.raw(`CREATE TABLE IF NOT EXISTS processed_events (
        subscription_name text NOT NULL,
        event_id text NOT NULL,
        processed_at timestamptz NOT NULL,
        PRIMARY KEY (subscription_name, event_id)
      )`),
    )
  },
  async down(tx) {
    await tx.execute(sql.raw('DROP TABLE IF EXISTS processed_events'))
  },
}

export const idempotencyResponsesMigration: Migration<SqlExecutor> = {
  name: 'create_idempotency_responses',
  async up(tx) {
    await tx.execute(
      sql.raw(`CREATE TABLE IF NOT EXISTS idempotency_responses (
        idempotency_key text NOT NULL,
        route text NOT NULL,
        body_hash text NOT NULL,
        status integer NOT NULL,
        response_body jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (idempotency_key, route, body_hash)
      )`),
    )
  },
  async down(tx) {
    await tx.execute(sql.raw('DROP TABLE IF EXISTS idempotency_responses'))
  },
}

/**
 * Where a message the delivery budget gave up on lands. `settleByDeliveryBudget` calls `term()`,
 * which stops redelivery for good; without this table that message was gone with no trace, in five
 * consumers, under a "never lost" claim. NOT swept by `gcDedup`: dedup rows are hygiene, dead
 * letters are evidence, and an expiring incident record is not an incident record.
 */
export const deadLettersMigration: Migration<SqlExecutor> = {
  name: 'create_dead_letters',
  async up(tx) {
    await tx.execute(
      sql.raw(`CREATE TABLE IF NOT EXISTS dead_letters (
        subscription_name text NOT NULL,
        event_id text NOT NULL,
        -- event_id is empty when the message carried no Nats-Msg-Id, so it cannot be the key on
        -- its own: two DIFFERENT header-less losses on one subscription would collide and the
        -- second would overwrite the first. dedupe_key is the event id when there is one (so a
        -- real event re-poisoned by the same consumer still updates rather than accumulating) and
        -- the stream sequence otherwise, which is unique per message.
        dedupe_key text NOT NULL,
        subject text NOT NULL,
        delivery_count integer NOT NULL,
        reason text NOT NULL,
        payload jsonb NOT NULL,
        recorded_at timestamptz NOT NULL,
        PRIMARY KEY (subscription_name, dedupe_key)
      )`),
    )
  },
  async down(tx) {
    await tx.execute(sql.raw('DROP TABLE IF EXISTS dead_letters'))
  },
}

/** The messaging migration fragments, in dependency order. */
export const MESSAGING_MIGRATIONS: readonly Migration<SqlExecutor>[] = [
  outboxMigration,
  processedEventsMigration,
  idempotencyResponsesMigration,
  deadLettersMigration,
]

/**
 * The full messaging substrate (outbox + processed_events + idempotency_responses) composed into
 * one migration, so the standard adopter applies it with `messagingMigration.up(db)` after its
 * domain DDL — no per-service `composeMigrations([...])` copy. Pure consumers that skip the outbox
 * (identity, webhooks) compose the fragments they need directly instead.
 */
export const messagingMigration = composeMigrations(MESSAGING_MIGRATIONS)

/**
 * `messagingMigration` re-exposed as a NAMED `Migration` so a full adopter can drop it straight into
 * its own `composeMigrations([domain, messagingFragment])` pipeline. `composeMigrations` returns a
 * `name`-less object, which is exactly why content/flags/donations each hand-wrote an identical
 * `{ name: 'messaging', up, down }` relabel — this is that relabel, owned once.
 */
export const messagingFragment: Migration<SqlExecutor> = {
  name: 'messaging',
  up: (tx) => messagingMigration.up(tx),
  down: (tx) => messagingMigration.down(tx),
}

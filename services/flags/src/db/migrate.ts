import { composeMigrations, type Migration } from '@qaroom/contracts'
import { messagingMigration } from '@qaroom/messaging/migrations'
import { sql } from 'drizzle-orm'
import type { SqlExecutor } from './client'

/**
 * The flags-service domain table as a reversible migration fragment so the up→down→up→up
 * idempotency test (docs/05 migration discipline) covers it. The `up` is idempotent
 * (`IF NOT EXISTS`); the `down` drops in reverse. One row per (community, flag) holds the
 * rollout state.
 */
const flagsMigration: Migration<SqlExecutor> = {
  name: 'flags',
  async up(tx) {
    await tx.execute(
      sql.raw(`CREATE TABLE IF NOT EXISTS flags (
        community_id text NOT NULL,
        flag_key text NOT NULL,
        state text NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (community_id, flag_key)
      )`),
    )
  },
  async down(tx) {
    await tx.execute(sql.raw(`DROP TABLE IF EXISTS flags`))
  },
}

/**
 * The shared messaging substrate (outbox + processed_events + idempotency_responses) composed in
 * as a named fragment, unchanged from the canonical @qaroom/messaging definition.
 */
const messagingFragment: Migration<SqlExecutor> = {
  name: 'messaging',
  up: (tx) => messagingMigration.up(tx),
  down: (tx) => messagingMigration.down(tx),
}

/** The full flags-service schema: domain table + the composed messaging substrate. */
export const flagsMigrations = composeMigrations<SqlExecutor>([flagsMigration, messagingFragment])

/** Apply the flags-service schema. Idempotent; safe to call on every boot/test. */
export async function ensureSchema(db: SqlExecutor): Promise<void> {
  await flagsMigrations.up(db)
}

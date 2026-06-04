import { composeMigrations } from '@qaroom/contracts'
import {
  idempotencyResponsesMigration,
  outboxMigration,
  processedEventsMigration,
} from '@qaroom/messaging/migrations'
import { sql } from 'drizzle-orm'
import type { SqlExecutor } from './client'

const messagingTables = composeMigrations([
  outboxMigration,
  processedEventsMigration,
  idempotencyResponsesMigration,
])

/** Idempotent DDL: donations + the per-community flag-enabled cache. */
export const MIGRATION_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS donations (
    id text PRIMARY KEY,
    community_id text NOT NULL,
    donor_id text NOT NULL,
    amount_cents integer NOT NULL,
    currency text NOT NULL,
    status text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS donations_community_created_idx ON donations (community_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS flag_cache (
    community_id text NOT NULL,
    flag_key text NOT NULL,
    enabled boolean NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (community_id, flag_key)
  )`,
]

/** Apply the donations-service schema. Idempotent; safe to call on every boot/test. */
export async function ensureSchema(db: SqlExecutor): Promise<void> {
  for (const stmt of MIGRATION_STATEMENTS) {
    await db.execute(sql.raw(stmt))
  }
  await messagingTables.up(db)
}

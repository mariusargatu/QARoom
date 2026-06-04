import { composeMigrations } from '@qaroom/contracts'
import {
  idempotencyResponsesMigration,
  outboxMigration,
  processedEventsMigration,
} from '@qaroom/messaging/migrations'
import { sql } from 'drizzle-orm'
import type { SqlExecutor } from './client'

/**
 * Shared substrate tables from the `@qaroom/messaging` fragments so every service provisions
 * the SAME shape: the transactional outbox, the consumer dedup table, and the Idempotency-Key
 * replay store (Commitments 4 + 17).
 */
const messagingTables = composeMigrations([
  outboxMigration,
  processedEventsMigration,
  idempotencyResponsesMigration,
])

/** Idempotent DDL: a row per (community, flag) holding the rollout state. */
export const MIGRATION_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS flags (
    community_id text NOT NULL,
    flag_key text NOT NULL,
    state text NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (community_id, flag_key)
  )`,
]

/** Apply the flags-service schema. Idempotent; safe to call on every boot/test. */
export async function ensureSchema(db: SqlExecutor): Promise<void> {
  for (const stmt of MIGRATION_STATEMENTS) {
    await db.execute(sql.raw(stmt))
  }
  await messagingTables.up(db)
}

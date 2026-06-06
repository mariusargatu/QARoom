import { messagingMigration } from '@qaroom/messaging/migrations'
import { sql } from 'drizzle-orm'
import type { SqlExecutor } from './client'

/** Idempotent DDL: a row per (community, flag) holding the rollout state. */
const MIGRATION_STATEMENTS: readonly string[] = [
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
  await messagingMigration.up(db)
}

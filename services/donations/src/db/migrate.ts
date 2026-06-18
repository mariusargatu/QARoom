import { composeMigrations, type Migration } from '@qaroom/contracts'
import { messagingFragment } from '@qaroom/messaging/migrations'
import { sql } from 'drizzle-orm'
import type { SqlExecutor } from './client'

/**
 * The donations-service domain tables as reversible migration fragments so the up→down→up→up
 * idempotency test (docs/05 migration discipline) covers them. Each `up` is idempotent
 * (`IF NOT EXISTS`); the `down` drops in reverse (DROP TABLE takes the table's indexes with it).
 */
const donationsMigration: Migration<SqlExecutor> = {
  name: 'donations',
  async up(tx) {
    await tx.execute(
      sql.raw(`CREATE TABLE IF NOT EXISTS donations (
        id text PRIMARY KEY,
        community_id text NOT NULL,
        donor_id text NOT NULL,
        amount_cents integer NOT NULL,
        currency text NOT NULL,
        status text NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      )`),
    )
    await tx.execute(
      sql.raw(
        `CREATE INDEX IF NOT EXISTS donations_community_created_idx ON donations (community_id, created_at DESC)`,
      ),
    )
  },
  async down(tx) {
    await tx.execute(sql.raw(`DROP TABLE IF EXISTS donations`))
  },
}

/** The per-community flag-enabled cache the donations gate reads. */
const flagCacheMigration: Migration<SqlExecutor> = {
  name: 'flag_cache',
  async up(tx) {
    await tx.execute(
      sql.raw(`CREATE TABLE IF NOT EXISTS flag_cache (
        community_id text NOT NULL,
        flag_key text NOT NULL,
        enabled boolean NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (community_id, flag_key)
      )`),
    )
  },
  async down(tx) {
    await tx.execute(sql.raw(`DROP TABLE IF EXISTS flag_cache`))
  },
}

/** The full donations-service schema: domain tables + the composed messaging substrate. */
export const donationsMigrations = composeMigrations<SqlExecutor>([
  donationsMigration,
  flagCacheMigration,
  messagingFragment,
])

/** Apply the donations-service schema. Idempotent; safe to call on every boot/test. */
export async function ensureSchema(db: SqlExecutor): Promise<void> {
  await donationsMigrations.up(db)
}

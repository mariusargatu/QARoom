import { composeMigrations, type Migration, voteValueCheckSql } from '@qaroom/contracts'
import { messagingFragment } from '@qaroom/messaging/migrations'
import { sql } from 'drizzle-orm'
import type { SqlExecutor } from './client'

// The ±1 vote-value CHECK predicate, derived from contracts' VOTE_VALUES (single source) — the
// migration never hand-types the bounds. Used both inline in CREATE TABLE (fresh databases) and in
// the idempotent ALTER below (databases created before this constraint existed).
const VOTE_VALUE_CHECK = voteValueCheckSql('value')

/**
 * The content-service domain tables as reversible migration fragments so the up→down→up→up
 * idempotency test (docs/05 migration discipline) covers them. Each `up` is idempotent
 * (`IF NOT EXISTS`); the `down` drops in reverse (DROP TABLE takes the table's indexes with it).
 */
const postsMigration: Migration<SqlExecutor> = {
  name: 'posts',
  async up(tx) {
    await tx.execute(
      sql.raw(`CREATE TABLE IF NOT EXISTS posts (
        id text PRIMARY KEY,
        community_id text NOT NULL,
        author_id text NOT NULL,
        title text NOT NULL,
        body text NOT NULL,
        score integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL
      )`),
    )
    // The feed reads a community's posts newest-first.
    await tx.execute(
      sql.raw(
        `CREATE INDEX IF NOT EXISTS posts_community_created_idx ON posts (community_id, created_at DESC)`,
      ),
    )
  },
  async down(tx) {
    await tx.execute(sql.raw(`DROP TABLE IF EXISTS posts`))
  },
}

const votesMigration: Migration<SqlExecutor> = {
  name: 'votes',
  async up(tx) {
    await tx.execute(
      sql.raw(`CREATE TABLE IF NOT EXISTS votes (
        post_id text NOT NULL,
        voter_id text NOT NULL,
        value integer NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (post_id, voter_id),
        CONSTRAINT votes_value_check CHECK (${VOTE_VALUE_CHECK})
      )`),
    )
    // Idempotent forward-fill for databases created before the CHECK existed: ADD CONSTRAINT is not
    // IF-NOT-EXISTS-able in Postgres, so guard on pg_constraint. Fresh tables already carry it from
    // the CREATE above; this is a no-op there. Predicate derived from VOTE_VALUES (same source).
    await tx.execute(
      sql.raw(`DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'votes_value_check' AND conrelid = 'votes'::regclass
        ) THEN
          ALTER TABLE votes ADD CONSTRAINT votes_value_check CHECK (${VOTE_VALUE_CHECK});
        END IF;
      END $$`),
    )
  },
  async down(tx) {
    await tx.execute(sql.raw(`DROP TABLE IF EXISTS votes`))
  },
}

/**
 * The full content-service schema: domain tables + the shared messaging substrate
 * (outbox + processed_events + idempotency_responses). content publishes (outbox) and dedupes
 * consumed events, so it adopts the full substrate via the canonical @qaroom/messaging fragment.
 */
export const contentMigrations = composeMigrations<SqlExecutor>([
  postsMigration,
  votesMigration,
  messagingFragment,
])

/** Apply the content-service schema. Idempotent; safe to call on every boot/test. */
export async function ensureSchema(db: SqlExecutor): Promise<void> {
  await contentMigrations.up(db)
}

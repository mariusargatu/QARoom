import { composeMigrations, type Migration } from '@qaroom/contracts'
import { messagingMigration } from '@qaroom/messaging/migrations'
import { sql } from 'drizzle-orm'
import type { SqlExecutor } from './client'

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
        PRIMARY KEY (post_id, voter_id)
      )`),
    )
  },
  async down(tx) {
    await tx.execute(sql.raw(`DROP TABLE IF EXISTS votes`))
  },
}

/**
 * The shared messaging substrate (outbox + processed_events + idempotency_responses) composed in
 * as a named fragment, unchanged from the canonical @qaroom/messaging definition — content
 * publishes (outbox) and dedupes consumed events, so it adopts the full substrate.
 */
const messagingFragment: Migration<SqlExecutor> = {
  name: 'messaging',
  up: (tx) => messagingMigration.up(tx),
  down: (tx) => messagingMigration.down(tx),
}

/** The full content-service schema: domain tables + the composed messaging substrate. */
export const contentMigrations = composeMigrations<SqlExecutor>([
  postsMigration,
  votesMigration,
  messagingFragment,
])

/** Apply the content-service schema. Idempotent; safe to call on every boot/test. */
export async function ensureSchema(db: SqlExecutor): Promise<void> {
  await contentMigrations.up(db)
}

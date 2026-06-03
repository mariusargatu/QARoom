import { sql } from 'drizzle-orm'
import type { SqlExecutor } from './client'

/**
 * Milestone 0 schema is applied programmatically (idempotent DDL) so the test
 * harness can provision a fresh pglite schema per test and production can apply
 * it on boot. drizzle-kit-generated migration files land when deployment shape
 * matters (Milestone 3).
 */
export const MIGRATION_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS posts (
    id text PRIMARY KEY,
    community_id text NOT NULL,
    author_id text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    score integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS votes (
    post_id text NOT NULL,
    voter_id text NOT NULL,
    value integer NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (post_id, voter_id)
  )`,
  `CREATE TABLE IF NOT EXISTS idempotency_responses (
    idempotency_key text NOT NULL,
    route text NOT NULL,
    body_hash text NOT NULL,
    status integer NOT NULL,
    response_body jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (idempotency_key, route, body_hash)
  )`,
  `CREATE INDEX IF NOT EXISTS posts_community_created_idx ON posts (community_id, created_at DESC)`,
]

/** Apply the Milestone 0 schema. Idempotent; safe to call on every boot/test. */
export async function ensureSchema(db: SqlExecutor): Promise<void> {
  for (const stmt of MIGRATION_STATEMENTS) {
    await db.execute(sql.raw(stmt))
  }
}

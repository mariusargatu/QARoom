import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import postgres, { type Sql } from 'postgres'

/**
 * Real-Postgres fixture for the `pgSnapshotStore` integration spec. `snapshot-store.ts` is written
 * against the postgres-js wire client (`sql(name)` identifier escaping, `sql(rows)` bulk insert,
 * `sql.begin` REPEATABLE READ transactions, `SET session_replication_role`) — surfaces PGlite's
 * drizzle handle does not expose — so it can only be exercised against a real server.
 *
 * GATED, by design: it boots a throwaway Postgres container, so it runs ONLY when the coverage gate
 * opts in via `QAROOM_PG_TESTS=1` (see scripts/coverage.ts), keeping Docker out of the fast `pnpm
 * test` lane (the repo's tiering — Docker-needing tests are never in the in-process unit lane). When
 * the flag is unset, or Docker is unavailable, `setupSnapshotPg` returns null and the spec skips.
 *
 * Lives outside `*.spec.ts` because the no-conditional-in-test rule forbids the try/catch + loops
 * the container bring-up and schema reset need; excluded from coverage as test infrastructure.
 */
export interface SnapshotPgFixture {
  sql: Sql
  stop: () => Promise<void>
}

export async function setupSnapshotPg(): Promise<SnapshotPgFixture | null> {
  if (process.env.QAROOM_PG_TESTS !== '1') return null
  let container: StartedPostgreSqlContainer
  try {
    container = await new PostgreSqlContainer('postgres:18-alpine').start()
  } catch {
    // No reachable Docker daemon — skip rather than fail (the gate still runs everywhere).
    return null
  }
  const sql = postgres(container.getConnectionUri(), { max: 2 })
  return {
    sql,
    stop: async () => {
      await sql.end({ timeout: 5 })
      await container.stop()
    },
  }
}

// Two FK-linked domain tables, the three messaging plumbing tables, and a never-export table
// (identity-style private key material) — enough to exercise dump/skew/exclude/reset/bulk.
export async function createSnapshotSchema(sql: Sql): Promise<void> {
  await sql`CREATE TABLE post (id text PRIMARY KEY, title text NOT NULL, score int NOT NULL DEFAULT 0)`
  await sql`CREATE TABLE vote (id text PRIMARY KEY, post_id text NOT NULL REFERENCES post(id), value int NOT NULL)`
  await sql`CREATE TABLE outbox (id text PRIMARY KEY, payload jsonb NOT NULL)`
  await sql`CREATE TABLE processed_events (msg_id text PRIMARY KEY)`
  await sql`CREATE TABLE idempotency_responses (key text PRIMARY KEY, body jsonb NOT NULL)`
  await sql`CREATE TABLE signing_keys (kid text PRIMARY KEY, d text NOT NULL)`
}

const ALL_TABLES = [
  'vote',
  'post',
  'outbox',
  'processed_events',
  'idempotency_responses',
  'signing_keys',
]

export async function resetAll(sql: Sql): Promise<void> {
  for (const table of ALL_TABLES) {
    await sql`TRUNCATE ${sql(table)} CASCADE`
  }
}

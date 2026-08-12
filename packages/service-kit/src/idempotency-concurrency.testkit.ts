import { idempotencyResponsesMigration } from '@qaroom/messaging/migrations'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'

/**
 * Real-Postgres fixture for the idempotency concurrency spec.
 *
 * PGlite — which every service test runs on — is a SINGLE in-process connection, so it serializes
 * requests a production pool runs genuinely concurrently. That is not a detail: the concurrent
 * double-execute this fixture exists to catch is INVISIBLE on PGlite. Probed both ways on
 * 2026-08-12, ten concurrent same-key requests:
 *
 *   PGlite (single connection)      → 1 post   (clean pass, bug hidden)
 *   real Postgres, PG_POOL_MAX=10   → 8 posts  (the bug)
 *
 * `identity/tests/concurrency.spec.ts` predicted exactly this in a comment — "pglite is a single
 * in-process connection, so it serializes these rather than exercising true OS-level contention —
 * that lands with Testcontainers later" — and the follow-up never landed. This is it.
 *
 * Gated on QAROOM_PG_TESTS + Docker, mirroring `snapshot-store.testkit.ts`: the fast in-process lane
 * stays Docker-free, and an unreachable daemon skips rather than fails. Outside a `*.spec.ts`
 * because `qaroom/no-conditional-in-test` forbids the try/catch the container bring-up needs.
 */
export interface IdempotencyPgFixture {
  db: PostgresJsDatabase<Record<string, never>>
  sql: Sql
  /** Wipe the replay store between tests. */
  reset(): Promise<void>
  stop(): Promise<void>
}

/** Pool size mirrors service-kit's DEFAULT_POOL_MAX, so the contention matches production's. */
const POOL_MAX = 10

export async function setupIdempotencyPg(): Promise<IdempotencyPgFixture | null> {
  if (process.env.QAROOM_PG_TESTS !== '1') return null
  let container: StartedPostgreSqlContainer
  try {
    container = await new PostgreSqlContainer('postgres:18-alpine').start()
  } catch {
    // No reachable Docker daemon — skip rather than fail.
    return null
  }
  const sql = postgres(container.getConnectionUri(), { max: POOL_MAX })
  const db = drizzle(sql) as PostgresJsDatabase<Record<string, never>>
  await idempotencyResponsesMigration.up(db)
  return {
    db,
    sql,
    reset: async () => {
      await sql`TRUNCATE idempotency_responses`
    },
    stop: async () => {
      await sql.end({ timeout: 5 })
      await container.stop()
    },
  }
}

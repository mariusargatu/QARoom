import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'
import { processedEventsMigration } from './migrations'
import type { SqlExecutor, TxRunner } from './types'

/**
 * Real-Postgres fixture for the consumer-dedup concurrency spec.
 *
 * `processEvent` serializes concurrent deliveries of the same event with a transaction-scoped
 * advisory lock inside `alreadyProcessed`. That is correct — but it was correct only BY INSPECTION:
 * every consumer test runs on PGlite, a single in-process connection, which serializes everything
 * anyway and so cannot tell a working lock from a missing one. Delete the lock and the whole suite
 * stays green.
 *
 * This fixture gives the lock something to actually do: two transactions on two real connections,
 * racing for the same event.
 *
 * Gated on QAROOM_PG_TESTS + Docker, mirroring `snapshot-store.testkit.ts`.
 */
export interface SubscribePgFixture {
  db: TxRunner
  sql: Sql
  /** Rows written by the handler — the observable for "how many times did the effect run". */
  effectCount(): Promise<number>
  reset(): Promise<void>
  stop(): Promise<void>
}

/** Two connections is all the race needs; keeping it small makes lock contention obvious. */
const POOL_MAX = 4

export async function setupSubscribePg(): Promise<SubscribePgFixture | null> {
  if (process.env.QAROOM_PG_TESTS !== '1') return null
  let container: StartedPostgreSqlContainer
  try {
    container = await new PostgreSqlContainer('postgres:18-alpine').start()
  } catch {
    return null
  }
  const client = postgres(container.getConnectionUri(), { max: POOL_MAX })
  const drizzled = drizzle(client)
  const db = drizzled as unknown as TxRunner
  await processedEventsMigration.up(drizzled)
  await client`CREATE TABLE IF NOT EXISTS handler_effects (n serial PRIMARY KEY, event_id text)`
  return {
    db,
    sql: client,
    effectCount: async () => {
      const rows = await client`SELECT count(*)::int AS n FROM handler_effects`
      return (rows[0] as { n: number }).n
    },
    reset: async () => {
      await client`TRUNCATE processed_events, handler_effects`
    },
    stop: async () => {
      await client.end({ timeout: 5 })
      await container.stop()
    },
  }
}

/**
 * The handler effect, written through the SAME transaction `processEvent` hands the handler.
 *
 * The deliberate `pg_sleep` holds the transaction open long enough that a second delivery is
 * guaranteed to be inside its own check when the first is still working. Without it the race is
 * real but only sometimes observed, and a guard that reds intermittently is not a guard — the
 * point of this spec is to fail RELIABLY when the advisory lock is missing.
 */
export function recordEffect(eventId: string) {
  return async (tx: SqlExecutor): Promise<void> => {
    await tx.execute(sql`SELECT pg_sleep(0.15)`)
    await tx.execute(sql`INSERT INTO handler_effects (event_id) VALUES (${eventId})`)
  }
}

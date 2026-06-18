import type { SnapshotStore } from '@qaroom/contracts'
import { sql } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'
import { pgSnapshotStore } from './snapshot-store'
import type { SqlExecutor } from './types'

/** The postgres client, the Drizzle handle, and the snapshot store every DB service boots together. */
export interface ServiceDbHandle<TSchema extends Record<string, unknown>> {
  sql: Sql
  db: PostgresJsDatabase<TSchema>
  snapshotStore: SnapshotStore
}

/**
 * Open the postgres client + Drizzle handle + snapshot store in one call — the
 * `postgres(...) -> drizzle(...) -> pgSnapshotStore(...)` quartet that was copy-pasted into all five
 * services' `server.ts`. `max` is passed in (rather than read here) so this stays a pure messaging
 * primitive with no service-kit dependency, keeping the package graph one-directional. `exclude`
 * forwards the never-touch table set straight to `pgSnapshotStore` (e.g. identity's `signing_keys`).
 */
export function connectServiceDb<TSchema extends Record<string, unknown>>(opts: {
  connectionString: string
  schema: TSchema
  max: number
  exclude?: readonly string[]
}): ServiceDbHandle<TSchema> {
  const client = postgres(opts.connectionString, { max: opts.max })
  const db = drizzle(client, { schema: opts.schema })
  return { sql: client, db, snapshotStore: pgSnapshotStore(client, { exclude: opts.exclude }) }
}

/**
 * The `select 1` readiness probe, owned once. Both `PostgresJsDatabase` and the PGlite test db
 * satisfy `SqlExecutor`, so a service passes `dbReadiness(deps.db)` straight into `buildServiceApp`.
 */
export function dbReadiness(db: SqlExecutor): () => Promise<void> {
  return async () => {
    await db.execute(sql`select 1`)
  }
}

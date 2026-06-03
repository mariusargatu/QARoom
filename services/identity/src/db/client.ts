import type { SQL } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { schema } from './schema'

/**
 * The repository and routes are typed against the production driver. The test harness
 * builds a pglite-backed drizzle instance and casts it to `IdentityDb` at the boundary —
 * both implement the same drizzle `PgDatabase` surface, so the cast is sound and keeps
 * repository code driver-agnostic and `any`-free. Mirrors content-service.
 */
export type IdentityDb = PostgresJsDatabase<typeof schema>

/** Minimal raw-SQL surface: lets repository code and migrations accept a db or a tx without an `any` cast. */
export interface SqlExecutor {
  execute(query: SQL): Promise<unknown>
}

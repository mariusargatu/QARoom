import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { schema } from './schema'

/**
 * The repository and routes are typed against the production driver. The test harness
 * builds a pglite-backed drizzle instance and casts it to `IdentityDb` at the boundary —
 * both implement the same drizzle `PgDatabase` surface, so the cast is sound and keeps
 * repository code driver-agnostic and `any`-free. Mirrors content-service.
 */
export type IdentityDb = PostgresJsDatabase<typeof schema>

/** Shared cross-driver raw-SQL surface (one definition for every service). */
export type { SqlExecutor } from '@qaroom/messaging'

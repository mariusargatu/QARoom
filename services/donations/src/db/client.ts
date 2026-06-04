import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { schema } from './schema'

export type DonationsDb = PostgresJsDatabase<typeof schema>

/** Shared cross-driver raw-SQL surface (one definition for every service). */
export type { SqlExecutor } from '@qaroom/messaging'

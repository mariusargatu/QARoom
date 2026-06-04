import { sql } from 'drizzle-orm'
import type { SqlExecutor } from './types'

/**
 * Single-writer-per-resource (Commitment 4): serialize concurrent writers to the same resource
 * with a transaction-scoped Postgres advisory lock keyed on the resource id. The one home for
 * this primitive — every service's repository funnels its mutating paths through it instead of
 * re-authoring the `pg_advisory_xact_lock` call. The lock releases when the surrounding
 * transaction commits or rolls back, so it MUST be called inside a `db.transaction(...)`.
 */
export async function advisoryLock(ex: SqlExecutor, resourceId: string): Promise<void> {
  await ex.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${resourceId}, 0))`)
}

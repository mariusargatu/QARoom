import { asServiceDb } from '@qaroom/testing-utils/harness'
import type { ContentDb } from '../src/db/client'

/**
 * Content's typed alias of the shared single-audited cross-driver cast (`asServiceDb` in
 * testing-utils). Delegates rather than re-implementing the `db as T` boundary, so there is one
 * audited home. Tests build a pglite/postgres-js drizzle instance that implements the same drizzle
 * core surface production code uses; the cast is sound but unchecked.
 */
export const asContentDb = (db: unknown): ContentDb => asServiceDb<ContentDb>(db)

import { PGlite } from '@electric-sql/pglite'
import type { SQL } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { createSeededDeps, type SeedConfig, type SeededDeps } from './seeded-deps'
import type { MigrationTarget } from './setup-service-test'

/**
 * The single audited home for the cross-driver test cast. Production code is typed against the
 * postgres-js driver; tests build a pglite-backed drizzle instance that implements the same drizzle
 * core query-builder the repository uses, so the cast is sound but unchecked. One named helper means
 * the unsafe boundary is crossed one way, in one place, instead of re-authored at each call site.
 */
export const asServiceDb = <T>(db: unknown): T => db as T

export interface FreshPglite {
  db: ReturnType<typeof drizzle>
  pglite: PGlite
  close(): Promise<void>
}

/** A bare fresh in-memory Postgres (no migrations, no app). For the lowest-level DB tests. */
export function freshPglite(): FreshPglite {
  const pglite = new PGlite()
  const db = drizzle(pglite)
  return { db, pglite, close: () => pglite.close() }
}

/**
 * Run a raw SQL query against a pglite/drizzle db and return its rows, typed. Replaces the
 * `(res as unknown as { rows: R[] }).rows` unwrap reinvented across every service's DB test.
 */
export async function pgliteRows<R>(db: MigrationTarget, query: SQL): Promise<R[]> {
  const res = await db.execute(query)
  // Mirror @qaroom/messaging rowsOf (can't import it — testing-utils has no messaging dep): tolerate
  // BOTH the pglite `{ rows }` shape and the postgres-js array shape, so this stays driver-agnostic
  // instead of returning undefined (→ a downstream `.map` crash) on an array result.
  if (Array.isArray(res)) return res as R[]
  if (res && typeof res === 'object' && 'rows' in res) return (res as { rows: R[] }).rows
  return []
}

export interface RepoTest<Db> extends SeededDeps {
  db: Db
  pglite: PGlite
  close(): Promise<void>
}

/**
 * The bare-db (non-app) test seam the app-level `setupServiceTest` does not cover: a fresh PGlite +
 * applied migrations + the seeded determinism trio, with the db cast to the service's Db type. The
 * service composes its own RepoDeps (lamport/faults) from the returned trio. Replaces the
 * hand-rolled PGlite bootstrap duplicated in every repository/migration unit test.
 */
export async function setupRepoTest<Db>(opts: {
  applyMigrations(db: MigrationTarget): Promise<void>
  seed?: SeedConfig
}): Promise<RepoTest<Db>> {
  const pglite = new PGlite()
  try {
    const raw = drizzle(pglite)
    await opts.applyMigrations(raw as unknown as MigrationTarget)
    const seeded = createSeededDeps(opts.seed)
    return {
      db: asServiceDb<Db>(raw),
      pglite,
      ...seeded,
      close: () => pglite.close(),
    }
  } catch (err) {
    // Don't leak the wasm-backed instance when migrations throw.
    await pglite.close()
    throw err
  }
}

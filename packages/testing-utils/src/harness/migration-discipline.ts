import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asServiceDb, pgliteRows } from './pglite'
import type { MigrationTarget } from './setup-service-test'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'

/** Minimal reversible-migration shape (matches @qaroom/contracts composeMigrations output). */
export interface ReversibleMigration<Db> {
  up(db: Db): Promise<void>
  down(db: Db): Promise<void>
}

export interface MigrationDisciplineOptions<Db> {
  /** Label for the describe block, e.g. 'content'. */
  name: string
  migrations: ReversibleMigration<Db>
  /** Service-owned domain tables expected after up (e.g. ['posts','votes']). */
  domainTables: string[]
  /** Shared messaging tables; defaults to the standard three. Pass [] for a service without them. */
  messagingTables?: string[]
  /** Index names to assert present after up and gone after down (the invariant-bearing ones). */
  indexes?: string[]
}

const DEFAULT_MESSAGING = ['idempotency_responses', 'outbox', 'processed_events']

/**
 * Registers the migration-discipline suite (docs/05: up / down / up→down→up→up, NO snapshots) so it
 * is authored once instead of copy-pasted per service. Goes beyond the old name-only tests: when
 * `indexes` are given it asserts the invariant-bearing indexes (PK/partial-unique) exist after up and
 * are dropped with their tables. The service-specific reversibility NEGATIVE control (a broken `down`
 * with a domain oracle) stays in the service's own migration test — it needs domain knowledge.
 */
export function assertMigrationDiscipline<Db>(opts: MigrationDisciplineOptions<Db>): void {
  const messaging = opts.messagingTables ?? DEFAULT_MESSAGING
  const expectedTables = [...opts.domainTables, ...messaging]

  let pglite: PGlite
  let db: Db

  const tableNames = (): Promise<string[]> =>
    pgliteRows<{ table_name: string }>(
      db as unknown as MigrationTarget,
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    ).then((rows) => rows.map((r) => r.table_name))

  const indexNames = (): Promise<string[]> =>
    pgliteRows<{ indexname: string }>(
      db as unknown as MigrationTarget,
      sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
    ).then((rows) => rows.map((r) => r.indexname))

  describe(`${opts.name} migration discipline`, () => {
    // Hooks are scoped INSIDE the describe so a co-located sibling suite in the same file does not
    // inherit (and pay for) this PGlite setup/teardown.
    beforeEach(() => {
      pglite = new PGlite()
      db = asServiceDb<Db>(drizzle(pglite))
    })

    afterEach(async () => {
      await pglite.close()
    })

    it('up creates every domain + messaging table', async () => {
      await opts.migrations.up(db)
      const present = await tableNames()
      for (const t of expectedTables) expect(present).toContain(t)
    })

    it('down drops every domain + messaging table', async () => {
      await opts.migrations.up(db)
      await opts.migrations.down(db)
      const present = await tableNames()
      for (const t of expectedTables) expect(present).not.toContain(t)
    })

    it('is idempotent: up → down → up → up converges to the same table set', async () => {
      await opts.migrations.up(db)
      const afterFirstUp = await tableNames()
      await opts.migrations.down(db)
      await opts.migrations.up(db)
      await opts.migrations.up(db)
      expect(await tableNames()).toEqual(afterFirstUp)
    })

    // Registered only when invariant-bearing indexes are declared — no vacuous test otherwise.
    if (opts.indexes && opts.indexes.length > 0) {
      const indexes = opts.indexes
      it('declared indexes exist after up and are dropped with their tables on down', async () => {
        await opts.migrations.up(db)
        const present = await indexNames()
        for (const i of indexes) expect(present).toContain(i)
        await opts.migrations.down(db)
        const afterDown = await indexNames()
        for (const i of indexes) expect(afterDown).not.toContain(i)
      })
    }
  })
}

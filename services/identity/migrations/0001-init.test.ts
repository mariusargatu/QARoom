import { PGlite } from '@electric-sql/pglite'
import { COMM_GENERAL, composeMigrations, type Migration } from '@qaroom/contracts'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { asServiceDb, pgliteRows } from '@qaroom/testing-utils/harness'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { IdentityDb, SqlExecutor } from '../src/db/client'
import { IDENTITY_MIGRATIONS } from '../src/db/migrate'

/**
 * Migration discipline (docs/05): up → down → up → up(no-op) with structural assertions
 * at each step (NO snapshots). The identity schema migration is the reversibility/idempotency
 * star of Milestone 2; a sibling test demonstrates a deliberately broken `down` being caught.
 */
const EXPECTED_TABLES = [
  'communities',
  'idempotency_responses',
  'memberships',
  // identity became an outbox producer in Milestone 13 (the GDPR erasure saga, ADR-0036).
  'outbox',
  'sessions',
  'signing_keys',
  'users',
]

const composed = composeMigrations(IDENTITY_MIGRATIONS)
let pglite: PGlite
let db: IdentityDb

const tables = (): Promise<string[]> =>
  pgliteRows<{ table_name: string }>(
    db,
    sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
  ).then((rows) => rows.map((r) => r.table_name))

const indexNames = (): Promise<string[]> =>
  pgliteRows<{ indexname: string }>(
    db,
    sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
  ).then((rows) => rows.map((r) => r.indexname))

const generalSeedCount = (): Promise<number> =>
  pgliteRows<{ n: number }>(
    db,
    sql`SELECT count(*)::int AS n FROM communities WHERE id = ${COMM_GENERAL}`,
  ).then((rows) => rows[0]?.n ?? 0)

beforeEach(() => {
  pglite = new PGlite()
  db = asServiceDb<IdentityDb>(drizzle(pglite))
})

afterEach(async () => {
  await pglite.close()
})

describe('identity schema migration (0001 init)', () => {
  it('creates every identity table and seeds exactly one general community on up', async () => {
    await composed.up(db)
    expect(await tables()).toEqual(EXPECTED_TABLES)
    expect(await generalSeedCount()).toBe(1)
  })

  it('removes every identity table on down (full reversal)', async () => {
    await composed.up(db)
    await composed.down(db)
    expect(await tables()).toEqual([])
  })

  it('is reproducible and idempotent: up→down→up→up converges to the same tables and a single general community', async () => {
    await composed.up(db)
    const afterFirstUp = await tables()
    await composed.down(db)
    await composed.up(db)
    const afterReUp = await tables()
    await composed.up(db)
    const afterNoOpUp = await tables()
    expect(afterReUp).toEqual(afterFirstUp)
    expect(afterNoOpUp).toEqual(afterFirstUp)
    expect(await generalSeedCount()).toBe(1)
  })

  it('creates the invariant-bearing indexes on up and drops them with their tables on down', async () => {
    await composed.up(db)
    const present = await indexNames()
    // The rotation invariant (at most one 'current' signing key) and the membership-by-community
    // lookup are enforced by indexes, not just table existence — the old name-only test missed both.
    expect(present).toContain('signing_keys_one_current')
    expect(present).toContain('memberships_community_idx')

    await composed.down(db)
    const afterDown = await indexNames()
    expect(afterDown).not.toContain('signing_keys_one_current')
    expect(afterDown).not.toContain('memberships_community_idx')
  })

  it('down-reversal discipline catches a broken migration composed into the real set', async () => {
    const broken: Migration<SqlExecutor> = {
      name: 'broken-no-down',
      async up(tx) {
        await tx.execute(sql.raw('CREATE TABLE IF NOT EXISTS broken_demo (id text PRIMARY KEY)'))
      },
      async down() {
        /* deliberately a no-op: the reversal assertion below must catch this */
      },
    }
    // Compose the broken step onto the REAL identity migrations and run the real reversal, so the
    // gate's own predicate ('down drops every table') is exercised against migrate.ts — not a
    // self-contained toy. Every real down runs, leaving ONLY the broken step's residue behind.
    const withBroken = composeMigrations([...IDENTITY_MIGRATIONS, broken])
    await withBroken.up(db)
    await withBroken.down(db)
    // If any REAL migration's down regressed to a no-op, this would be more than [broken_demo] and
    // the negative control would itself go red — so it now has teeth over the real schema.
    expect(await tables()).toEqual(['broken_demo'])
  })
})

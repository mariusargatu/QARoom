import { PGlite } from '@electric-sql/pglite'
import { COMM_GENERAL } from '@qaroom/contracts'
import type { Clock } from '@qaroom/determinism'
import { asServiceDb, pgliteRows } from '@qaroom/testing-utils/harness'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { IdentityDb } from '../src/db/client'
import { runIdentityMigration } from '../src/db/migrate'

/**
 * The migration state machine's Verifying step is the only guard that the schema actually
 * arrived in a usable shape (the general community seed parses, ADR-0007). These pin that the
 * guard has TEETH: a healthy provision reaches Done, but a DB whose seed never landed must be
 * REJECTED, not waved through. A verify predicate stubbed to always-true would survive every
 * other gate — this adverse-DB test is what catches it.
 */

// Inline fixed Clock (new Date is lint-exempt in tests); runIdentityMigration only needs `now`.
const clock: Clock = { now: () => new Date('2026-01-01T00:00:00.000Z') }

let pglite: PGlite
let db: IdentityDb

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

describe('runIdentityMigration verify step', () => {
  it('drives a healthy DB to Done — the general community seed lands and verification passes', async () => {
    await expect(runIdentityMigration(db, { clock })).resolves.toBeUndefined()
    expect(await generalSeedCount()).toBe(1)
  })

  it('rejects a DB where the seed silently never lands (verification must fail, not pass)', async () => {
    // Pre-create the communities table with a BEFORE INSERT trigger that swallows every row, so the
    // migration's seed INSERT runs without error yet leaves NO general community behind. This models
    // a provision where seeding silently failed — the exact state the Verifying step exists to catch.
    await db.execute(
      sql.raw(`CREATE TABLE communities (
        id text PRIMARY KEY,
        slug text NOT NULL UNIQUE,
        name text NOT NULL,
        created_at timestamptz NOT NULL
      )`),
    )
    await db.execute(
      sql.raw(`CREATE OR REPLACE FUNCTION swallow_insert() RETURNS trigger
        AS $$ BEGIN RETURN NULL; END; $$ LANGUAGE plpgsql`),
    )
    await db.execute(
      sql.raw(`CREATE TRIGGER communities_no_seed BEFORE INSERT ON communities
        FOR EACH ROW EXECUTE FUNCTION swallow_insert()`),
    )

    await expect(runIdentityMigration(db, { clock })).rejects.toThrow(/verification failed/)
    expect(await generalSeedCount()).toBe(0)
  })
})

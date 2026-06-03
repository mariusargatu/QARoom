import { PGlite } from '@electric-sql/pglite'
import { COMM_GENERAL, composeMigrations, type Migration } from '@qaroom/contracts'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
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
  'sessions',
  'signing_keys',
  'users',
]

const composed = composeMigrations(IDENTITY_MIGRATIONS)
let pglite: PGlite
let db: IdentityDb

const tables = async (): Promise<string[]> => {
  const res = await db.execute(
    sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
  )
  return (res as unknown as { rows: Array<{ table_name: string }> }).rows.map((r) => r.table_name)
}

const generalSeedCount = async (): Promise<number> => {
  const res = await db.execute(sql`SELECT count(*)::int AS n FROM communities WHERE id = ${COMM_GENERAL}`)
  return (res as unknown as { rows: Array<{ n: number }> }).rows[0]?.n ?? 0
}

beforeEach(() => {
  pglite = new PGlite()
  db = drizzle(pglite) as unknown as IdentityDb
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

  it('catches a deliberately broken migration whose down does not drop its table', async () => {
    const broken: Migration<SqlExecutor> = {
      name: 'broken-no-down',
      async up(tx) {
        await tx.execute(sql.raw('CREATE TABLE IF NOT EXISTS broken_demo (id text PRIMARY KEY)'))
      },
      async down() {
        /* deliberately a no-op: the reversal assertion below must catch this */
      },
    }
    await broken.up(db)
    await broken.down(db)
    // A correct down would drop broken_demo; the broken one leaves it present.
    expect(await tables()).toContain('broken_demo')
  })
})

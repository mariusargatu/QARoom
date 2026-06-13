import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SqlExecutor } from './client'
import { donationsMigrations } from './migrate'

/**
 * Migration discipline (docs/05): up → down → up → up(no-op) with structural assertions at each
 * step (NO snapshots). Covers the donations-domain tables plus the composed messaging fragments.
 */
const DONATIONS_TABLES = ['donations', 'flag_cache']
const MESSAGING_TABLES = ['idempotency_responses', 'outbox', 'processed_events']

let pglite: PGlite
let db: SqlExecutor

const tables = async (): Promise<string[]> => {
  const res = await db.execute(
    sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
  )
  return (res as unknown as { rows: Array<{ table_name: string }> }).rows.map((r) => r.table_name)
}

beforeEach(() => {
  pglite = new PGlite()
  db = drizzle(pglite) as unknown as SqlExecutor
})

afterEach(async () => {
  await pglite.close()
})

describe('donations migrations', () => {
  it('creates the donations + messaging tables on up', async () => {
    await donationsMigrations.up(db)
    const present = await tables()
    for (const t of DONATIONS_TABLES) expect(present).toContain(t)
    for (const t of MESSAGING_TABLES) expect(present).toContain(t)
  })

  it('drops the donations + messaging tables on down', async () => {
    await donationsMigrations.up(db)
    await donationsMigrations.down(db)
    const present = await tables()
    for (const t of DONATIONS_TABLES) expect(present).not.toContain(t)
    for (const t of MESSAGING_TABLES) expect(present).not.toContain(t)
  })

  it('is idempotent: up → down → up → up converges to the same schema', async () => {
    await donationsMigrations.up(db)
    const afterFirstUp = await tables()
    await donationsMigrations.down(db)
    await donationsMigrations.up(db)
    await donationsMigrations.up(db) // second up is a no-op (IF NOT EXISTS)
    const afterReUp = await tables()
    expect(afterReUp).toEqual(afterFirstUp)
  })
})

import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SqlExecutor } from './client'
import { contentMigrations } from './migrate'

/**
 * Migration discipline (docs/05): up → down → up → up(no-op) with structural assertions at each
 * step (NO snapshots). Covers the content-domain tables plus the composed messaging fragments.
 */
const CONTENT_TABLES = ['posts', 'votes']
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

describe('content migrations', () => {
  it('creates the content + messaging tables on up', async () => {
    await contentMigrations.up(db)
    const present = await tables()
    for (const t of CONTENT_TABLES) expect(present).toContain(t)
    for (const t of MESSAGING_TABLES) expect(present).toContain(t)
  })

  it('drops the content + messaging tables on down', async () => {
    await contentMigrations.up(db)
    await contentMigrations.down(db)
    const present = await tables()
    for (const t of CONTENT_TABLES) expect(present).not.toContain(t)
    for (const t of MESSAGING_TABLES) expect(present).not.toContain(t)
  })

  it('is idempotent: up → down → up → up converges to the same schema', async () => {
    await contentMigrations.up(db)
    const afterFirstUp = await tables()
    await contentMigrations.down(db)
    await contentMigrations.up(db)
    await contentMigrations.up(db) // second up is a no-op (IF NOT EXISTS)
    const afterReUp = await tables()
    expect(afterReUp).toEqual(afterFirstUp)
  })
})

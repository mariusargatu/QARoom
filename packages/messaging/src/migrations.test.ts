import { PGlite } from '@electric-sql/pglite'
import { composeMigrations } from '@qaroom/contracts'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { describe, expect, it } from 'vitest'
import { MESSAGING_MIGRATIONS, messagingFragment } from './migrations'
import { rowsOf, type SqlExecutor } from './types'

const composed = composeMigrations(MESSAGING_MIGRATIONS)
const MESSAGING_TABLES = ['idempotency_responses', 'outbox', 'processed_events']

function freshDb(): SqlExecutor {
  return drizzle(new PGlite()) as unknown as SqlExecutor
}

async function messagingTables(db: SqlExecutor): Promise<string[]> {
  const res = await db.execute(
    sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
  )
  return rowsOf<{ table_name: string }>(res)
    .map((r) => r.table_name)
    .filter((t) => MESSAGING_TABLES.includes(t))
}

describe('messaging migration fragments are reversible and idempotent', () => {
  it('creates outbox, processed_events, and idempotency_responses on up', async () => {
    const db = freshDb()
    await composed.up(db)
    expect(await messagingTables(db)).toEqual(MESSAGING_TABLES)
  })

  it('drops every messaging table on down', async () => {
    const db = freshDb()
    await composed.up(db)
    await composed.down(db)
    expect(await messagingTables(db)).toEqual([])
  })

  it('converges on up then down then up then up (idempotent DDL)', async () => {
    const db = freshDb()
    await composed.up(db)
    const afterFirstUp = await messagingTables(db)
    await composed.down(db)
    await composed.up(db)
    const afterReUp = await messagingTables(db)
    await composed.up(db)
    const afterNoOpUp = await messagingTables(db)
    expect(afterReUp).toEqual(afterFirstUp)
    expect(afterNoOpUp).toEqual(afterFirstUp)
  })
})

describe('messagingFragment relabels the composed substrate as a named Migration', () => {
  it('is named "messaging" so a full adopter can drop it into composeMigrations', () => {
    expect(messagingFragment.name).toBe('messaging')
  })

  it('creates every messaging table on up', async () => {
    const db = freshDb()
    await messagingFragment.up(db)
    expect(await messagingTables(db)).toEqual(MESSAGING_TABLES)
  })

  it('drops every messaging table on down', async () => {
    const db = freshDb()
    await messagingFragment.up(db)
    await messagingFragment.down(db)
    expect(await messagingTables(db)).toEqual([])
  })
})

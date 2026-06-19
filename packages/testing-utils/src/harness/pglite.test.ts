import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { asServiceDb, freshPglite, pgliteRows, setupRepoTest } from './pglite'
import type { MigrationTarget } from './setup-service-test'

describe('pglite helpers', () => {
  it('asServiceDb returns the same reference, retyped', () => {
    const original = { marker: 1 }
    expect(asServiceDb<object>(original)).toBe(original)
  })

  it('freshPglite + pgliteRows run a query and return typed rows', async () => {
    const { db, close } = freshPglite()
    const rows = await pgliteRows<{ n: number }>(db as unknown as MigrationTarget, sql`SELECT 1::int AS n`)
    await close()
    expect(rows[0]?.n).toBe(1)
  })

  it('setupRepoTest applies migrations and exposes the seeded trio', async () => {
    const ctx = await setupRepoTest<MigrationTarget>({
      applyMigrations: async (db) => {
        await db.execute(sql.raw('CREATE TABLE thing (id text)'))
      },
    })
    const rows = await pgliteRows<{ count: number }>(ctx.db, sql`SELECT count(*)::int AS count FROM thing`)
    await ctx.close()
    expect(rows[0]?.count).toBe(0)
    expect(ctx.clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(ctx.ids.next('x').startsWith('x_')).toBe(true)
  })
})

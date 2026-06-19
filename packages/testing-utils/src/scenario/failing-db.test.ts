import { sql } from 'drizzle-orm'
import { pgTable, text } from 'drizzle-orm/pg-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { freshPglite, pgliteRows } from '../harness/pglite'
import { failingDb, InjectedDbError } from './failing-db'

/**
 * The failingDb proxy must fail EXACTLY the declared operation and pass everything else straight
 * through to the real pglite — otherwise a scenario can't run several clean operations and fail one.
 * Verified against a real pglite (not a mock): the proxy is the only fault.
 */
const things = pgTable('things', { id: text('id').primaryKey() })

let world: ReturnType<typeof freshPglite>
const db = () => world.db

beforeEach(async () => {
  world = freshPglite()
  await world.db.execute(sql.raw('CREATE TABLE things (id text PRIMARY KEY)'))
})

afterEach(async () => {
  await world.close()
})

describe('failingDb insert', () => {
  it('throws InjectedDbError on a matching insert', () => {
    const fdb = failingDb(db(), { op: 'insert', table: 'things' })

    expect(() => fdb.insert(things)).toThrow(InjectedDbError)
  })

  it('passes a non-matching table straight through to a real insert', async () => {
    const fdb = failingDb(db(), { op: 'insert', table: 'other_table' })

    await fdb.insert(things).values({ id: 'a' })

    expect(await pgliteRows<{ id: string }>(db(), sql`SELECT id FROM things`)).toEqual([
      { id: 'a' },
    ])
  })

  it('honors nth: the first matching insert succeeds and the second throws', async () => {
    const fdb = failingDb(db(), { op: 'insert', table: 'things', nth: 2 })

    await fdb.insert(things).values({ id: 'a' })
    expect(() => fdb.insert(things)).toThrow(InjectedDbError)
  })
})

describe('failingDb transaction', () => {
  it('rejects a matching transaction before the body runs', async () => {
    const fdb = failingDb(db(), { op: 'transaction' })
    let bodyRan = false

    await expect(
      fdb.transaction(async () => {
        bodyRan = true
      }),
    ).rejects.toBeInstanceOf(InjectedDbError)
    expect(bodyRan).toBe(false)
  })

  it('fails an insert declared on the wrapped tx handle inside a transaction', async () => {
    const fdb = failingDb(db(), { op: 'insert', table: 'things' })

    await expect(
      fdb.transaction(async (tx) => {
        await tx.insert(things).values({ id: 'a' })
      }),
    ).rejects.toBeInstanceOf(InjectedDbError)

    // The transaction rolled back, so nothing was written.
    const rows = await pgliteRows<{ n: number }>(db(), sql`SELECT count(*)::int AS n FROM things`)
    expect(rows[0]?.n).toBe(0)
  })
})

describe('failingDb execute', () => {
  it('rejects a matching raw execute', async () => {
    const fdb = failingDb(db(), { op: 'execute' })

    await expect(fdb.execute(sql`SELECT 1`)).rejects.toBeInstanceOf(InjectedDbError)
  })
})

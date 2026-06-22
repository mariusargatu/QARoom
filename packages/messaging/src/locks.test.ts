import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { describe, expect, it } from 'vitest'
import { advisoryLock } from './locks'
import type { SqlExecutor, TxRunner } from './types'

// PGlite is real Postgres (WASM), so pg_advisory_xact_lock + hashtextextended exist. The lock is
// transaction-scoped, so it must be taken inside db.transaction(...) — exactly how a repository
// funnels its mutating path through it. A live multi-connection contention race needs real Postgres
// (see infraOnly); here we assert the primitive issues its lock without error.
describe('advisoryLock takes a transaction-scoped advisory lock keyed on the resource id', () => {
  it('acquires the lock inside a transaction without error', async () => {
    const db = drizzle(new PGlite()) as unknown as SqlExecutor & TxRunner
    await expect(
      db.transaction(async (tx) => {
        await advisoryLock(tx, 'post_abc')
        return 'locked'
      }),
    ).resolves.toBe('locked')
  })

  it('hashes distinct resource ids independently within one transaction', async () => {
    const db = drizzle(new PGlite()) as unknown as SqlExecutor & TxRunner
    await expect(
      db.transaction(async (tx) => {
        await advisoryLock(tx, 'post_1')
        await advisoryLock(tx, 'post_2')
        return 'both'
      }),
    ).resolves.toBe('both')
  })
})

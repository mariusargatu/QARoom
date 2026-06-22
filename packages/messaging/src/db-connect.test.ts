import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { describe, expect, it } from 'vitest'
import { connectServiceDb, dbReadiness } from './db-connect'
import type { SqlExecutor } from './types'

// postgres-js opens no socket until the first query, so constructing the handle is pure: no live
// Postgres is touched (a real round-trip through it is exercised by each service's integration
// suite). We build it, assert the quartet wiring, then end the (never-connected) client.
describe('connectServiceDb assembles the client, Drizzle handle, and snapshot store', () => {
  it('returns the sql client, db handle, and a snapshot store without connecting', async () => {
    const handle = connectServiceDb({
      connectionString: 'postgres://qaroom:qaroom@localhost:5432/unused',
      schema: {},
      max: 1,
    })
    expect(typeof handle.sql).toBe('function')
    expect(handle.db).toBeDefined()
    expect(typeof handle.snapshotStore.capture).toBe('function')
    expect(typeof handle.snapshotStore.restore).toBe('function')
    await handle.sql.end()
  })
})

// `connectServiceDb` opens a live postgres-js client (real Postgres) — see infraOnly. `dbReadiness`
// only runs `select 1` through a `SqlExecutor`, which PGlite satisfies, so it is unit-testable.
describe('dbReadiness probes the database with select 1', () => {
  it('resolves when the underlying db answers the probe', async () => {
    const db = drizzle(new PGlite()) as unknown as SqlExecutor
    const probe = dbReadiness(db)
    await expect(probe()).resolves.toBeUndefined()
  })

  it('rejects when the underlying db cannot answer', async () => {
    const failing: SqlExecutor = {
      execute: () => Promise.reject(new Error('connection refused')),
    }
    const probe = dbReadiness(failing)
    await expect(probe()).rejects.toThrow('connection refused')
  })
})

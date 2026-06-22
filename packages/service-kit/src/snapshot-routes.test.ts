import {
  LamportGate,
  SNAPSHOT_SCHEMA_VERSION,
  type SnapshotStore,
  type SnapshotTables,
} from '@qaroom/contracts'
import Fastify, { type FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import { registerProblemHandler } from './problem'
import { createReplayDeps, registerSnapshotRoutes } from './snapshot'

const stubIds = { next: (prefix: string) => `${prefix}_stub` }
const stubClock = { now: () => new Date('2026-01-01T00:00:00.000Z') }

interface MemStore {
  store: SnapshotStore
  restoredWith: () => SnapshotTables | null
}

function memStore(captured: SnapshotTables = { posts: [{ id: 'post_1' }] }): MemStore {
  const state = { restored: null as SnapshotTables | null }
  return {
    restoredWith: () => state.restored,
    store: {
      capture: async () => captured,
      restore: async (tables) => {
        state.restored = tables
      },
    },
  }
}

// A store whose restore always rejects — the replay-failure path, as its own double so the test
// body stays conditional-free.
function failingRestoreStore(): SnapshotStore {
  return {
    capture: async () => ({ posts: [{ id: 'post_1' }] }),
    restore: async () => {
      throw new Error('constraint violation on replay')
    },
  }
}

function appWithSnapshot(
  store: SnapshotStore | undefined,
  lamport = new LamportGate(stubIds),
): FastifyInstance {
  const app = Fastify({ logger: false })
  registerProblemHandler(app)
  registerSnapshotRoutes(app, { service: 'demo', clock: stubClock, lamport, store })
  return app
}

function validBundle(tables: SnapshotTables, lamport = 5) {
  return {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    service: 'demo',
    captured_at: '2026-01-01T00:00:00.000Z',
    lamport,
    clock_seed: '2026-01-01T00:00:00.000Z',
    tables,
  }
}

describe('registerSnapshotRoutes', () => {
  it('does not mount the routes when no store is supplied (caller wires unconditionally)', async () => {
    const app = appWithSnapshot(undefined)
    const res = await app.inject({ method: 'GET', url: '/system/snapshot' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('captures the DB dump paired with the lamport and clock instant', async () => {
    const lamport = new LamportGate(stubIds)
    lamport.bump()
    lamport.bump()
    const app = appWithSnapshot(memStore().store, lamport)
    const res = await app.inject({ method: 'GET', url: '/system/snapshot' })
    expect(res.statusCode).toBe(200)
    expect(res.json().schema_version).toBe(SNAPSHOT_SCHEMA_VERSION)
    expect(res.json().lamport).toBe(2)
    expect(res.json().clock_seed).toBe('2026-01-01T00:00:00.000Z')
    expect(res.json().tables).toEqual({ posts: [{ id: 'post_1' }] })
    await app.close()
  })

  it('restores a valid bundle, replaying the tables and resetting the lamport', async () => {
    const lamport = new LamportGate(stubIds)
    const mem = memStore()
    const app = appWithSnapshot(mem.store, lamport)
    const res = await app.inject({
      method: 'POST',
      url: '/system/snapshot',
      payload: validBundle({ posts: [{ id: 'post_9' }] }, 7),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ restored: true, service: 'demo', lamport: 7 })
    expect(mem.restoredWith()).toEqual({ posts: [{ id: 'post_9' }] })
    expect(lamport.value).toBe(7)
    await app.close()
  })

  it('surfaces a restore failure as a 422 carrying the real cause (de-swallowed)', async () => {
    const app = appWithSnapshot(failingRestoreStore())
    const res = await app.inject({
      method: 'POST',
      url: '/system/snapshot',
      payload: validBundle({ posts: [] }),
    })
    expect(res.statusCode).toBe(422)
    expect(res.json().detail).toContain('constraint violation on replay')
    expect(res.json().failure_domain).toBe('validation')
    await app.close()
  })

  it('rejects a bundle with an unknown schema_version as a 400', async () => {
    const app = appWithSnapshot(memStore().store)
    const res = await app.inject({
      method: 'POST',
      url: '/system/snapshot',
      payload: { ...validBundle({ posts: [] }), schema_version: 999 },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})

describe('createReplayDeps', () => {
  it('pins the production trio clock to the supplied snapshot clock seed', () => {
    const deps = createReplayDeps('2026-03-04T05:06:07.000Z')
    expect(deps.clock.now().toISOString()).toBe('2026-03-04T05:06:07.000Z')
  })
})

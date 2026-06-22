import type { OasOperation, SnapshotStore } from '@qaroom/contracts'
import { LamportGate } from '@qaroom/contracts'
import type { FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import { buildServiceApp, type ServiceAppOptions } from './service-app'

const stubIds = { next: (prefix: string) => `${prefix}_stub` }
const stubClock = { now: () => new Date('2026-01-01T00:00:00.000Z') }

const OPERATIONS: OasOperation[] = [
  {
    operationId: 'getThing',
    method: 'get',
    path: '/things/{id}',
    summary: 'Get a thing',
    description: 'Returns a thing.',
    mutating: false,
    responses: [{ code: 200, description: 'ok' }],
  },
]

function build(overrides: Partial<ServiceAppOptions> = {}): FastifyInstance {
  return buildServiceApp({
    service: 'demo',
    clock: stubClock,
    lamport: new LamportGate(stubIds),
    operations: OPERATIONS,
    registerRoutes: (app) => {
      app.get('/things/:id', async () => ({ id: 'thing_1' }))
    },
    ...overrides,
  })
}

describe('buildServiceApp', () => {
  it('mounts the health, system-state, capabilities, and domain routes together', async () => {
    const app = build()
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/system/state' })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/system/capabilities' })).statusCode).toBe(200)
    const domain = await app.inject({ method: 'GET', url: '/things/abc' })
    expect(domain.statusCode).toBe(200)
    expect(domain.json()).toEqual({ id: 'thing_1' })
    await app.close()
  })

  it('wires the shared RFC 7807 problem handler (unknown route → 404 problem)', async () => {
    const app = build()
    const res = await app.inject({ method: 'GET', url: '/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.json().failure_domain).toBe('not_found')
    await app.close()
  })

  it('runs the injected readiness check on /ready and 503s when it rejects', async () => {
    const app = build({
      readiness: async () => {
        throw new Error('db down')
      },
    })
    const res = await app.inject({ method: 'GET', url: '/ready' })
    expect(res.statusCode).toBe(503)
    await app.close()
  })

  it('does NOT mount /system/snapshot when no snapshotStore is supplied', async () => {
    const app = build()
    const res = await app.inject({ method: 'GET', url: '/system/snapshot' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('mounts /system/snapshot when a snapshotStore is supplied', async () => {
    const store: SnapshotStore = {
      capture: async () => ({ posts: [] }),
      restore: async () => {},
    }
    const app = build({ snapshotStore: store })
    const res = await app.inject({ method: 'GET', url: '/system/snapshot' })
    expect(res.statusCode).toBe(200)
    expect(res.json().service).toBe('demo')
    await app.close()
  })
})

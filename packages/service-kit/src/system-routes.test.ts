import type { OasOperation } from '@qaroom/contracts'
import { LamportGate } from '@qaroom/contracts'
import Fastify, { type FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import { registerProblemHandler } from './problem'
import { registerSystemRoutes, type SystemRoutesOptions } from './system-routes'

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
    params: [
      { name: 'id', in: 'path', required: true, description: 'id', schema: { type: 'string' } },
    ],
    responses: [{ code: 200, description: 'ok' }],
  },
]

function appWith(overrides: Partial<SystemRoutesOptions> = {}): FastifyInstance {
  const app = Fastify({ logger: false })
  registerProblemHandler(app)
  registerSystemRoutes(app, {
    service: 'demo',
    clock: stubClock,
    lamport: new LamportGate(stubIds),
    operations: OPERATIONS,
    ...overrides,
  })
  return app
}

describe('registerSystemRoutes /system/state', () => {
  it('defaults the models map to {} when no provider is supplied', async () => {
    const app = appWith()
    const res = await app.inject({ method: 'GET', url: '/system/state' })
    expect(res.statusCode).toBe(200)
    expect(res.json().service).toBe('demo')
    expect(res.json().models).toEqual({})
    await app.close()
  })

  it('reports the per-model state from the injected (async) provider', async () => {
    const app = appWith({ models: async () => ({ migration: { state: 'applied' } }) })
    const res = await app.inject({ method: 'GET', url: '/system/state' })
    expect(res.statusCode).toBe(200)
    expect(res.json().models).toEqual({ migration: { state: 'applied' } })
    expect(res.json().as_of.lamport).toBe(0)
    await app.close()
  })
})

describe('registerSystemRoutes /system/capabilities', () => {
  it('derives the capability list from the operation registry', async () => {
    const app = appWith()
    const res = await app.inject({ method: 'GET', url: '/system/capabilities' })
    expect(res.statusCode).toBe(200)
    expect(res.json().service).toBe('demo')
    expect(res.json().capabilities[0].operation_id).toBe('getThing')
    expect(res.json().capabilities[0].method).toBe('GET')
    await app.close()
  })
})

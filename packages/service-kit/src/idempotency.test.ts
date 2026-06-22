import type { SqlExecutor } from '@qaroom/messaging/idempotency'
import Fastify, { type FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import { withIdempotency } from './idempotency'
import { inMemoryIdempotencyDb } from './idempotency-fake'
import { registerProblemHandler } from './problem'

const stubClock = { now: () => new Date('2026-01-01T00:00:00.000Z') }
const ROUTE = 'POST /things'

interface Harness {
  app: FastifyInstance
  produceCalls: () => number
}

function appWithIdempotentRoute(db: SqlExecutor): Harness {
  const counter = { n: 0 }
  const app = Fastify({ logger: false })
  registerProblemHandler(app)
  app.post('/things', async (req, reply) => {
    await withIdempotency(
      req,
      reply,
      { db, clock: stubClock, route: ROUTE, status: 201 },
      async () => {
        counter.n += 1
        return { id: 'thing_1', attempt: counter.n }
      },
    )
  })
  return { app, produceCalls: () => counter.n }
}

describe('withIdempotency', () => {
  it('runs produce once and sends the fresh-success status on a first request', async () => {
    const { app, produceCalls } = appWithIdempotentRoute(inMemoryIdempotencyDb())
    const res = await app.inject({
      method: 'POST',
      url: '/things',
      headers: { 'idempotency-key': 'key-1' },
      payload: { name: 'a' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({ id: 'thing_1', attempt: 1 })
    expect(produceCalls()).toBe(1)
    await app.close()
  })

  it('replays the stored response without re-running produce on an identical retry', async () => {
    const { app, produceCalls } = appWithIdempotentRoute(inMemoryIdempotencyDb())
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/things',
        headers: { 'idempotency-key': 'key-1' },
        payload: { name: 'a' },
      })
    const first = await send()
    const second = await send()
    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)
    expect(second.json()).toEqual(first.json())
    expect(produceCalls()).toBe(1)
    await app.close()
  })

  it('returns a 409 conflict when the same key is reused with a different body', async () => {
    const { app, produceCalls } = appWithIdempotentRoute(inMemoryIdempotencyDb())
    await app.inject({
      method: 'POST',
      url: '/things',
      headers: { 'idempotency-key': 'key-1' },
      payload: { name: 'a' },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/things',
      headers: { 'idempotency-key': 'key-1' },
      payload: { name: 'DIFFERENT' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().failure_domain).toBe('conflict')
    expect(produceCalls()).toBe(1)
    await app.close()
  })

  it('returns a 400 when the Idempotency-Key header is missing', async () => {
    const { app, produceCalls } = appWithIdempotentRoute(inMemoryIdempotencyDb())
    const res = await app.inject({ method: 'POST', url: '/things', payload: { name: 'a' } })
    expect(res.statusCode).toBe(400)
    expect(produceCalls()).toBe(0)
    await app.close()
  })
})

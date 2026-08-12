import { SystemClock } from '@qaroom/determinism'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { withIdempotency } from './idempotency'
import { type IdempotencyPgFixture, setupIdempotencyPg } from './idempotency-concurrency.testkit'
import { registerProblemHandler } from './problem'

/**
 * The retry boundary under REAL concurrency (Commitment 4).
 *
 * `idempotency.test.ts` covers the sequential path — same key twice, one after the other — which is
 * the easy half. The half that matters in production is a client whose first request has not
 * returned yet: it times out and retries while the original is still in flight. That is the single
 * most common trigger for a retry, and until 2026-08-12 it double-executed. Measured against a live
 * content-service on real Postgres: ten concurrent same-key requests produced EIGHT posts and eight
 * outbox events, all ten answered 201.
 *
 * Runs against real Postgres with a production-sized pool because PGlite cannot express the failure
 * (see the testkit): on a single connection the same probe returns a clean pass.
 */
const ROUTE = 'POST /widgets'

const fx = await setupIdempotencyPg()
const fixture = fx as IdempotencyPgFixture

/** Count how many times the guarded effect actually runs across a burst of requests. */
function buildApp(onProduce: () => void): FastifyInstance {
  const app = Fastify()
  registerProblemHandler(app)
  app.post('/widgets', async (req, reply) => {
    await withIdempotency(
      req,
      reply,
      { db: fixture.db, clock: new SystemClock(), route: ROUTE, status: 201 },
      async () => {
        onProduce()
        // Yield across a real DB round-trip, so the window between the replay check and the store
        // is as wide as a real handler's. Without it the race is real but far harder to observe.
        await fixture.sql`SELECT pg_sleep(0.05)`
        return { ok: true }
      },
    )
  })
  return app
}

/** Fire `n` identical requests concurrently, all carrying the same Idempotency-Key. */
async function burst(app: FastifyInstance, n: number, key: string): Promise<number[]> {
  const results = await Promise.all(
    Array.from({ length: n }, () =>
      app.inject({
        method: 'POST',
        url: '/widgets',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        payload: { a: 1 },
      }),
    ),
  )
  return results.map((r) => r.statusCode)
}

describe.skipIf(!fx)('withIdempotency under concurrent same-key requests', () => {
  beforeEach(async () => {
    await fixture.reset()
  })

  afterAll(async () => {
    await (fx as IdempotencyPgFixture | null)?.stop()
  })

  it('executes the guarded effect exactly once for ten concurrent identical requests', async () => {
    let produced = 0
    const app = buildApp(() => {
      produced += 1
    })

    await burst(app, 10, 'same-key')

    await app.close()
    expect(produced).toBe(1)
  })

  it('answers every concurrent caller without a 5xx', async () => {
    const app = buildApp(() => undefined)

    const statuses = await burst(app, 10, 'same-key-2')

    await app.close()
    expect(statuses.filter((s) => s >= 500)).toEqual([])
  })

  // The losers must not be told the mutation succeeded when it was someone else's. Either they get
  // the winner's stored response (201) or an explicit retryable conflict — never a fresh execution.
  it('answers each concurrent caller with either the stored response or a retryable conflict', async () => {
    const app = buildApp(() => undefined)

    const statuses = await burst(app, 10, 'same-key-3')

    await app.close()
    expect(statuses.filter((s) => s !== 201 && s !== 409)).toEqual([])
  })

  it('still replays the stored response for a sequential retry after the burst settles', async () => {
    let produced = 0
    const app = buildApp(() => {
      produced += 1
    })

    await burst(app, 5, 'same-key-4')
    const later = await app.inject({
      method: 'POST',
      url: '/widgets',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'same-key-4' },
      payload: { a: 1 },
    })

    await app.close()
    expect(later.statusCode).toBe(201)
    expect(produced).toBe(1)
  })
})

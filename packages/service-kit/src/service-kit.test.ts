import type { OasOperation } from '@qaroom/contracts'
import { LamportGate } from '@qaroom/contracts'
import { SpanStatusCode, startInMemoryTelemetry, trace } from '@qaroom/otel'
import Fastify, { type FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { buildCapabilities } from './capabilities'
import { registerHealthRoutes } from './health-routes'
import { ensureShutdownSignal } from './lifecycle'
import { ProblemError, problem, registerProblemHandler } from './problem'

const stubIds = { next: (prefix: string) => `${prefix}_stub` }
const stubClock = { now: () => new Date('2026-01-01T00:00:00.000Z') }

describe('the service-kit problem builder', () => {
  it('builds a ProblemError whose type URI derives from the slug and carries headers', () => {
    const err = problem({
      slug: 'rate-limited',
      title: 'Too many requests',
      status: 429,
      failure_domain: 'rate_limit',
      retryable: true,
      headers: { 'retry-after': '1' },
    })
    expect(err).toBeInstanceOf(ProblemError)
    expect(err.problem.type).toBe('https://qaroom.dev/errors/rate-limited')
    expect(err.headers['retry-after']).toBe('1')
  })
})

describe('the service-kit capabilities builder', () => {
  it('maps each operation to an MCP-tool-shaped capability with an object input_schema', () => {
    const operations: OasOperation[] = [
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
    const caps = buildCapabilities('demo', operations, stubClock, new LamportGate(stubIds))
    expect(caps.service).toBe('demo')
    expect(caps.capabilities[0]?.operation_id).toBe('getThing')
    expect(caps.capabilities[0]?.input_schema.type).toBe('object')
  })
})

/**
 * The shared problem handler defends the RFC 7807 contract (Commitment 13) for EVERY
 * service at once, so each error-mapping branch is tested directly — especially the
 * client-fault detection broadened during the content→service-kit extraction and the
 * 5xx no-leak path. A regression here breaks the error contract repo-wide.
 */
function appThatThrows(thrower: () => void): FastifyInstance {
  const app = Fastify({ logger: false })
  registerProblemHandler(app)
  app.get('/boom', async () => {
    thrower()
    return {}
  })
  app.post('/echo', async (req) => req.body as object)
  return app
}

describe('the service-kit problem handler', () => {
  it('maps a thrown ProblemError to its status, content-type, and headers', async () => {
    const app = appThatThrows(() => {
      throw problem({
        slug: 'rate-limited',
        title: 'Too many requests',
        status: 429,
        failure_domain: 'rate_limit',
        retryable: true,
        headers: { 'retry-after': '3' },
      })
    })
    const res = await app.inject({ method: 'GET', url: '/boom' })
    expect(res.statusCode).toBe(429)
    expect(res.headers['retry-after']).toBe('3')
    expect(res.headers['content-type']).toContain('application/problem+json')
    await app.close()
  })

  it('maps a ZodError to a 400 validation problem', async () => {
    const app = appThatThrows(() => {
      z.string().parse(123)
    })
    const res = await app.inject({ method: 'GET', url: '/boom' })
    expect(res.statusCode).toBe(400)
    expect(res.json().failure_domain).toBe('validation')
    await app.close()
  })

  it('maps malformed JSON (a content-type-parser fault) to a 400, not a 500', async () => {
    const app = appThatThrows(() => {})
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{not valid json',
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('maps an unexpected error to a 500 that does NOT leak the underlying message', async () => {
    const app = appThatThrows(() => {
      throw new Error('SENSITIVE connection string')
    })
    const res = await app.inject({ method: 'GET', url: '/boom' })
    expect(res.statusCode).toBe(500)
    expect(res.json().detail).toBe('An unexpected error occurred.')
    expect(JSON.stringify(res.json())).not.toContain('SENSITIVE')
    await app.close()
  })

  // Every service runs `Fastify({ logger: false })`, so `req.log.error` is a no-op: the
  // ONLY surviving record of a genuine 500 is the exception recorded on the live request
  // span. Without a real tracer `getActiveSpan()` is undefined, so we run the request inside
  // an active span and assert the handler stamped it (OTel records an exception as a span
  // event named 'exception'; an internal 500 must never go silent).
  it('records the exception and an ERROR status on the active span for a server-fault 500', async () => {
    const telemetry = startInMemoryTelemetry()
    const app = appThatThrows(() => {
      throw new Error('SENSITIVE connection string')
    })
    await trace.getTracer('test').startActiveSpan('request', async (span) => {
      const res = await app.inject({ method: 'GET', url: '/boom' })
      expect(res.statusCode).toBe(500)
      span.end()
    })

    const requestSpan = telemetry.exporter.getFinishedSpans().find((s) => s.name === 'request')
    const exceptionEvents = (requestSpan?.events ?? []).filter((e) => e.name === 'exception')
    expect(exceptionEvents).toHaveLength(1)
    expect(requestSpan?.status.code).toBe(SpanStatusCode.ERROR)
    // The recorded exception stays internal to the span; the leak guard above proves it
    // never reaches the response body.
    expect(exceptionEvents[0]?.attributes?.['exception.message']).toContain('SENSITIVE')

    await app.close()
    await telemetry.shutdown()
  })

  it('does NOT touch the active span on a client-fault 4xx (only server faults are recorded)', async () => {
    const telemetry = startInMemoryTelemetry()
    const app = appThatThrows(() => {
      z.string().parse(123)
    })
    await trace.getTracer('test').startActiveSpan('request', async (span) => {
      const res = await app.inject({ method: 'GET', url: '/boom' })
      expect(res.statusCode).toBe(400)
      span.end()
    })

    const requestSpan = telemetry.exporter.getFinishedSpans().find((s) => s.name === 'request')
    const exceptionEvents = (requestSpan?.events ?? []).filter((e) => e.name === 'exception')
    expect(exceptionEvents).toHaveLength(0)
    expect(requestSpan?.status.code).not.toBe(SpanStatusCode.ERROR)

    await app.close()
    await telemetry.shutdown()
  })

  it('maps an unknown route to a 404 route-not-found problem', async () => {
    const app = Fastify({ logger: false })
    registerProblemHandler(app)
    const res = await app.inject({ method: 'GET', url: '/does-not-exist' })
    expect(res.statusCode).toBe(404)
    expect(res.json().failure_domain).toBe('not_found')
    await app.close()
  })
})

describe('the service-kit health routes', () => {
  it('serves a 200 liveness response on /health naming the service', async () => {
    const app = Fastify({ logger: false })
    registerProblemHandler(app)
    registerHealthRoutes(app, { service: 'demo' })
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok', service: 'demo' })
    await app.close()
  })

  it('reports ready on /ready when the injected readiness check resolves', async () => {
    const app = Fastify({ logger: false })
    registerProblemHandler(app)
    registerHealthRoutes(app, { service: 'demo', readiness: async () => {} })
    const res = await app.inject({ method: 'GET', url: '/ready' })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('ready')
    await app.close()
  })

  it('reports a 503 dependency_failure problem on /ready when the readiness check rejects', async () => {
    const app = Fastify({ logger: false })
    registerProblemHandler(app)
    registerHealthRoutes(app, {
      service: 'demo',
      readiness: async () => {
        throw new Error('db unreachable')
      },
    })
    const res = await app.inject({ method: 'GET', url: '/ready' })
    expect(res.statusCode).toBe(503)
    expect(res.headers['content-type']).toContain('application/problem+json')
    const body = res.json()
    expect(body.failure_domain).toBe('dependency_failure')
    // The full RFC 7807 agent contract, not just the status: a down dependency is retryable, carries
    // a derived `type` URI, and the mandatory `next_actions` array (Commitment 13).
    expect(body.retryable).toBe(true)
    expect(body.type).toBe('https://qaroom.dev/errors/service-not-ready')
    expect(Array.isArray(body.next_actions)).toBe(true)
    await app.close()
  })

  it('keeps /health a 200 liveness response while /ready fails on a down dependency', async () => {
    // Liveness and readiness are deliberately split: a transient dependency outage must fail
    // readiness (k8s stops routing) WITHOUT failing liveness (k8s must not restart-loop the pod).
    const app = Fastify({ logger: false })
    registerProblemHandler(app)
    registerHealthRoutes(app, {
      service: 'demo',
      readiness: async () => {
        throw new Error('db unreachable')
      },
    })
    expect((await app.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(503)
    const health = await app.inject({ method: 'GET', url: '/health' })
    expect(health.statusCode).toBe(200)
    expect(health.json()).toEqual({ status: 'ok', service: 'demo' })
    await app.close()
  })

  it('treats a service with no readiness check as always ready', async () => {
    const app = Fastify({ logger: false })
    registerProblemHandler(app)
    registerHealthRoutes(app, { service: 'gateway' })
    const res = await app.inject({ method: 'GET', url: '/ready' })
    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it('fails /ready with a 503 service-draining problem once graceful shutdown begins', async () => {
    const app = Fastify({ logger: false })
    registerProblemHandler(app)
    // A readiness check that always passes — so the only thing that can fail /ready is the drain.
    registerHealthRoutes(app, { service: 'demo', readiness: async () => {} })
    expect((await app.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(200)

    ensureShutdownSignal(app).beginDrain()

    const res = await app.inject({ method: 'GET', url: '/ready' })
    expect(res.statusCode).toBe(503)
    expect(res.headers['content-type']).toContain('application/problem+json')
    const body = res.json()
    expect(body.failure_domain).toBe('dependency_failure')
    expect(body.retryable).toBe(true)
    expect(body.type).toBe('https://qaroom.dev/errors/service-draining')
    await app.close()
  })

  it('keeps /health a 200 liveness response while draining', async () => {
    const app = Fastify({ logger: false })
    registerProblemHandler(app)
    registerHealthRoutes(app, { service: 'demo', readiness: async () => {} })
    ensureShutdownSignal(app).beginDrain()
    const health = await app.inject({ method: 'GET', url: '/health' })
    expect(health.statusCode).toBe(200)
    expect(health.json()).toEqual({ status: 'ok', service: 'demo' })
    await app.close()
  })
})

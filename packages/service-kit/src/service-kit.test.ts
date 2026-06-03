import type { OasOperation } from '@qaroom/contracts'
import { LamportGate } from '@qaroom/contracts'
import Fastify, { type FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { buildCapabilities } from './capabilities'
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

  it('maps an unknown route to a 404 route-not-found problem', async () => {
    const app = Fastify({ logger: false })
    registerProblemHandler(app)
    const res = await app.inject({ method: 'GET', url: '/does-not-exist' })
    expect(res.statusCode).toBe(404)
    expect(res.json().failure_domain).toBe('not_found')
    await app.close()
  })
})

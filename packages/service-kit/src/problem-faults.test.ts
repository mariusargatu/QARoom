import Fastify, { type FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import { registerProblemHandler } from './problem'

/**
 * Pins the two `clientFaultStatus` branches the JSON-body test does not reach: a bare
 * `SyntaxError` (no statusCode) and a Fastify content-type-parser `FST_ERR_CTP*` code, both of
 * which are the client's fault and must map to 400 rather than leaking as a 500.
 */
function appThatThrows(thrower: () => never): FastifyInstance {
  const app = Fastify({ logger: false })
  registerProblemHandler(app)
  app.get('/boom', async () => {
    thrower()
  })
  return app
}

describe('the problem handler client-fault detection', () => {
  it('maps a bare SyntaxError (no statusCode) to a 400', async () => {
    const app = appThatThrows(() => {
      throw new SyntaxError('Unexpected token')
    })
    const res = await app.inject({ method: 'GET', url: '/boom' })
    expect(res.statusCode).toBe(400)
    expect(res.json().failure_domain).toBe('validation')
    await app.close()
  })

  it('maps a Fastify FST_ERR_CTP* content-type-parser fault to a 400', async () => {
    const app = appThatThrows(() => {
      const err = new Error('content type parser failure') as Error & { code: string }
      err.code = 'FST_ERR_CTP_INVALID_MEDIA_TYPE'
      throw err
    })
    const res = await app.inject({ method: 'GET', url: '/boom' })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})

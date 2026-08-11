import { describe, expect, it } from 'vitest'
import { crosscheckInteraction } from './index'

const OAS = {
  openapi: '3.0.3',
  info: { title: 'crosscheck fixture', version: '1.0.0' },
  paths: {
    '/widgets/{id}': {
      get: {
        operationId: 'getWidget',
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id', 'name'],
                  additionalProperties: false,
                  properties: { id: { type: 'string' }, name: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
  },
}

/** An operation with a strict requestBody plus a bodiless 204 — the two holes closed 2026-08-11. */
const MUTATING_OAS = {
  openapi: '3.0.3',
  info: { title: 'mutating fixture', version: '1.0.0' },
  paths: {
    '/widgets': {
      post: {
        operationId: 'createWidget',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                additionalProperties: false,
                properties: { name: { type: 'string' } },
              },
            },
          },
        },
        responses: { '201': { description: 'created' } },
      },
    },
    '/widgets/{id}': {
      delete: { operationId: 'deleteWidget', responses: { '204': { description: 'gone' } } },
    },
  },
}

describe('crosscheckInteraction validates the REQUEST half against the OAS requestBody', () => {
  it('accepts a request body matching the operation requestBody schema', async () => {
    const result = await crosscheckInteraction(MUTATING_OAS, {
      request: { method: 'POST', path: '/widgets', body: { name: 'gear' } },
      response: { status: 201 },
    })
    expect(result.ok, result.errors.join('; ')).toBe(true)
  })

  it('rejects a request body the provider spec forbids (provider verification would not: it replays the pact)', async () => {
    const result = await crosscheckInteraction(MUTATING_OAS, {
      request: { method: 'POST', path: '/widgets', body: { nmae: 'typo' } },
      response: { status: 201 },
    })
    expect(result.ok).toBe(false)
    expect(result.errors.join('; ')).toContain('request')
  })

  it('rejects a request body sent to an operation that declares no requestBody', async () => {
    const result = await crosscheckInteraction(MUTATING_OAS, {
      request: { method: 'DELETE', path: '/widgets/w1', body: { surprise: true } },
      response: { status: 204 },
    })
    expect(result.ok).toBe(false)
  })
})

describe('crosscheckInteraction no longer passes vacuously when a response declares no schema', () => {
  it('accepts a bodiless status whose response declares no schema (204)', async () => {
    const result = await crosscheckInteraction(MUTATING_OAS, {
      request: { method: 'DELETE', path: '/widgets/w1' },
      response: { status: 204 },
    })
    expect(result.ok, result.errors.join('; ')).toBe(true)
  })

  it('rejects an interaction carrying a body the spec declares no schema for', async () => {
    const result = await crosscheckInteraction(MUTATING_OAS, {
      request: { method: 'DELETE', path: '/widgets/w1' },
      response: { status: 204, body: { deleted: true } },
    })
    expect(result.ok).toBe(false)
    expect(result.errors.join('; ')).toContain('declares no schema')
  })
})

describe('crosscheckInteraction', () => {
  it('accepts an interaction whose response body matches the OAS operation schema', async () => {
    const result = await crosscheckInteraction(OAS, {
      request: { method: 'GET', path: '/widgets/abc' },
      response: { status: 200, body: { id: 'w1', name: 'gear' } },
    })
    expect(result.ok).toBe(true)
    expect(result.operationId).toBe('getWidget')
  })

  it('rejects an interaction whose response body carries a field the spec forbids', async () => {
    const result = await crosscheckInteraction(OAS, {
      request: { method: 'GET', path: '/widgets/abc' },
      response: { status: 200, body: { id: 'w1', name: 'gear', nmae: 'renamed' } },
    })
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('rejects an interaction whose response field has the wrong type', async () => {
    const result = await crosscheckInteraction(OAS, {
      request: { method: 'GET', path: '/widgets/abc' },
      response: { status: 200, body: { id: 'w1', name: 42 } },
    })
    expect(result.ok).toBe(false)
  })

  /**
   * This case USED to be the "violates the schema" test, asserting `ok: false` for a response body
   * missing a required property. That was wrong about what a Pact response body is: a PROJECTION of
   * the fields the consumer consumes, not the provider's full response. gateway's donations 404
   * pins five of ProblemDetails' six required fields and omits `next_actions`, which `makeProblem`
   * always sends — correct Pact usage that the old rule would have called drift. "Does the provider
   * actually send every required field" is provider-verification's and Schemathesis's job, against
   * a live service; keeping the three orthogonal is this module's stated design (docs/03 §6).
   */
  it('accepts a response body that omits a required field the consumer does not consume', async () => {
    const result = await crosscheckInteraction(OAS, {
      request: { method: 'GET', path: '/widgets/abc' },
      response: { status: 200, body: { id: 'w1' } },
    })
    expect(result.ok, result.errors.join('; ')).toBe(true)
  })

  it('rejects an interaction whose path is absent from the contract', async () => {
    const result = await crosscheckInteraction(OAS, {
      request: { method: 'GET', path: '/gadgets/abc' },
      response: { status: 200, body: {} },
    })
    expect(result.ok).toBe(false)
  })

  it('fails loudly when more than one OAS path matches (ambiguity), instead of picking the first', async () => {
    const ambiguousOas = {
      openapi: '3.0.3',
      info: { title: 'ambiguous', version: '1.0.0' },
      paths: {
        '/widgets/{id}': {
          get: { operationId: 'getWidget', responses: { '200': { description: 'ok' } } },
        },
        '/widgets/featured': {
          get: { operationId: 'getFeatured', responses: { '200': { description: 'ok' } } },
        },
      },
    }
    const result = await crosscheckInteraction(ambiguousOas, {
      request: { method: 'GET', path: '/widgets/featured' },
      response: { status: 200, body: {} },
    })
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('ambiguous')
  })
})

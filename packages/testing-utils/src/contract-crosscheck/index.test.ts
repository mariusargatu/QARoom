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

describe('crosscheckInteraction', () => {
  it('accepts an interaction whose response body matches the OAS operation schema', async () => {
    const result = await crosscheckInteraction(OAS, {
      request: { method: 'GET', path: '/widgets/abc' },
      response: { status: 200, body: { id: 'w1', name: 'gear' } },
    })
    expect(result.ok).toBe(true)
    expect(result.operationId).toBe('getWidget')
  })

  it('rejects an interaction whose response body violates the OAS operation schema', async () => {
    const result = await crosscheckInteraction(OAS, {
      request: { method: 'GET', path: '/widgets/abc' },
      response: { status: 200, body: { id: 'w1' } },
    })
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
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

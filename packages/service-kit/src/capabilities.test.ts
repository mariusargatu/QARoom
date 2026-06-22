import type { OasOperation } from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'
import { operationInputSchema } from './capabilities'

/**
 * `operationInputSchema` shapes one operation into an MCP-tool input schema. The branches that
 * the higher-level capabilities test does not reach are the request-body and required-param
 * paths — pinned directly here.
 */
describe('operationInputSchema', () => {
  it('adds a required `body` property when the operation has a request body', () => {
    const op: OasOperation = {
      operationId: 'createThing',
      method: 'post',
      path: '/things',
      summary: 'Create a thing',
      description: 'Creates a thing.',
      mutating: true,
      requestBodyRef: 'CreateThing',
      responses: [{ code: 201, description: 'created' }],
    }
    const schema = operationInputSchema(op)
    expect(schema.type).toBe('object')
    expect((schema.properties as Record<string, unknown>).body).toEqual({
      $ref: '#/components/schemas/CreateThing',
    })
    expect(schema.required).toContain('body')
    expect(schema.additionalProperties).toBe(false)
  })

  it('marks a required path param as required and a non-required query param as optional', () => {
    const op: OasOperation = {
      operationId: 'listThings',
      method: 'get',
      path: '/communities/{communityId}/things',
      summary: 'List things',
      description: 'Lists things.',
      mutating: false,
      params: [
        {
          name: 'communityId',
          in: 'path',
          required: true,
          description: 'tenant',
          schema: { type: 'string' },
        },
        {
          name: 'cursor',
          in: 'query',
          required: false,
          description: 'page',
          schema: { type: 'string' },
        },
      ],
      responses: [{ code: 200, description: 'ok' }],
    }
    const schema = operationInputSchema(op)
    expect(Object.keys(schema.properties as Record<string, unknown>)).toEqual([
      'communityId',
      'cursor',
    ])
    expect(schema.required).toEqual(['communityId'])
  })

  it('emits an empty required list for an operation with no params or body', () => {
    const op: OasOperation = {
      operationId: 'ping',
      method: 'get',
      path: '/ping',
      summary: 'Ping',
      description: 'Ping.',
      mutating: false,
      responses: [{ code: 200, description: 'ok' }],
    }
    expect(operationInputSchema(op).required).toEqual([])
  })
})

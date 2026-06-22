import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
// Register the schemas the operations below reference.
import '../post'
import { buildOpenApiDocument, type OasOperation, schemaRef, stringifyOpenApi } from './builder'

const createPost: OasOperation = {
  operationId: 'createPost',
  method: 'post',
  path: '/api/communities/{communityId}/posts',
  summary: 'Create a post',
  description: 'Creates a post in a community.',
  tags: ['posts'],
  mutating: true,
  params: [
    {
      name: 'communityId',
      in: 'path',
      required: true,
      description: 'Target community.',
      schema: { type: 'string' },
    },
  ],
  requestBodyRef: 'CreatePostRequest',
  requestExample: { author_id: 'user_x', title: 't', body: 'b' },
  responses: [
    {
      code: 201,
      description: 'Created.',
      bodyRef: 'Post',
      example: { id: 'post_x' },
      links: { GetPost: { operationId: 'getPost' } },
    },
  ],
}

const getFeed: OasOperation = {
  operationId: 'getFeed',
  method: 'get',
  path: '/api/communities/{communityId}/posts',
  summary: 'Read the feed',
  description: 'Returns the community feed.',
  mutating: false,
  responses: [{ code: 200, description: 'A feed page.', bodyRef: 'Feed' }],
}

describe('schemaRef', () => {
  it('builds a components-schemas JSON ref from an id', () => {
    expect(schemaRef('Post')).toEqual({ $ref: '#/components/schemas/Post' })
  })
})

describe('buildOpenApiDocument', () => {
  it('emits a 3.0.3 document with info, paths, and components', () => {
    const doc = buildOpenApiDocument({ title: 'content', version: '1.0.0' }, [createPost])
    expect(doc.openapi).toBe('3.0.3')
    const info = doc.info as Record<string, unknown>
    expect(info.title).toBe('content')
  })

  it('includes an optional info description only when provided', () => {
    const withDesc = buildOpenApiDocument(
      { title: 'content', version: '1.0.0', description: 'the content service' },
      [getFeed],
    )
    const withoutDesc = buildOpenApiDocument({ title: 'content', version: '1.0.0' }, [getFeed])
    expect((withDesc.info as Record<string, unknown>).description).toBe('the content service')
    expect((withoutDesc.info as Record<string, unknown>).description).toBeUndefined()
  })

  it('renders an operation with its parameters, request body, and example', () => {
    const doc = buildOpenApiDocument({ title: 'content', version: '1.0.0' }, [createPost])
    const paths = doc.paths as {
      '/api/communities/{communityId}/posts': { post: Record<string, unknown> }
    }
    const op = paths['/api/communities/{communityId}/posts'].post
    expect((op.parameters as unknown[]).length).toBe(1)
    const requestBody = op.requestBody as Record<string, unknown>
    expect(requestBody.required).toBe(true)
  })

  it('attaches the response example and links to the response media', () => {
    const doc = buildOpenApiDocument({ title: 'content', version: '1.0.0' }, [createPost])
    const paths = doc.paths as {
      '/api/communities/{communityId}/posts': { post: { responses: Record<string, unknown> } }
    }
    const responses = paths['/api/communities/{communityId}/posts'].post.responses as {
      '201': Record<string, unknown>
    }
    expect(responses['201'].links).toEqual({ GetPost: { operationId: 'getPost' } })
    const content = responses['201'].content as { 'application/json': Record<string, unknown> }
    expect(content['application/json'].example).toEqual({ id: 'post_x' })
  })

  it('merges two operations that share one path into one path item', () => {
    const doc = buildOpenApiDocument({ title: 'content', version: '1.0.0' }, [createPost, getFeed])
    const paths = doc.paths as { '/api/communities/{communityId}/posts': Record<string, unknown> }
    const item = paths['/api/communities/{communityId}/posts']
    expect(Object.keys(item).sort()).toEqual(['get', 'post'])
  })

  it('includes the reachable request and response schemas in components', () => {
    const doc = buildOpenApiDocument({ title: 'content', version: '1.0.0' }, [createPost])
    const components = doc.components as { schemas: Record<string, unknown> }
    expect(components.schemas.Post).toBeDefined()
    expect(components.schemas.CreatePostRequest).toBeDefined()
  })

  it('adds a servers block only when servers are supplied', () => {
    const withServer = buildOpenApiDocument(
      { title: 'content', version: '1.0.0' },
      [getFeed],
      [{ url: 'https://api.qaroom.dev' }],
    )
    const withoutServer = buildOpenApiDocument({ title: 'content', version: '1.0.0' }, [getFeed])
    expect(withServer.servers).toEqual([{ url: 'https://api.qaroom.dev' }])
    expect(withoutServer.servers).toBeUndefined()
  })
})

describe('stringifyOpenApi', () => {
  it('round-trips a built document through deterministic YAML', () => {
    const doc = buildOpenApiDocument({ title: 'content', version: '1.0.0' }, [getFeed])
    expect(parse(stringifyOpenApi(doc)).openapi).toBe('3.0.3')
  })
})

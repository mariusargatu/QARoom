import { injectClient } from '@qaroom/testing-utils/harness'
import { expectRFC7807 } from '@qaroom/testing-utils/matchers'
import { describe, expect, it } from 'vitest'
import { setupMcpInMemory } from '../test-support/harness'
import { createMcpHttpApp, httpMcpClient, type RpcPost } from './http'

const VALID_POST_ID = `post_${'0'.repeat(26)}`

function rpcPost(request: ReturnType<typeof injectClient>): RpcPost {
  return async (body) => {
    const response = await request.post('/mcp', body)
    return { status: response.status, json: response.json }
  }
}

describe('the HTTP JSON-RPC transport', () => {
  it('serves the same tool list as the in-memory transport', async () => {
    const { core, client: inMemory } = setupMcpInMemory()
    const app = createMcpHttpApp(core)
    const httpClient = httpMcpClient(rpcPost(injectClient(app)))
    const overHttp = (await httpClient.listTools()).map((tool) => tool.name)
    const inProcess = (await inMemory.listTools()).map((tool) => tool.name)
    expect(overHttp).toEqual(inProcess)
    await app.close()
  })

  it('round-trips a tool call and re-validates the structured outcome', async () => {
    const { core } = setupMcpInMemory()
    const app = createMcpHttpApp(core)
    const httpClient = httpMcpClient(rpcPost(injectClient(app)))
    const outcome = await httpClient.callTool('content_getPost', { postId: VALID_POST_ID })
    expect(outcome.ok).toBe(true)
    await app.close()
  })

  it('returns a JSON-RPC method-not-found error for an unknown method', async () => {
    const { core } = setupMcpInMemory()
    const app = createMcpHttpApp(core)
    const response = await injectClient(app).post('/mcp', {
      jsonrpc: '2.0',
      id: 1,
      method: 'bogus/method',
    })
    expect((response.json as { error: { code: number } }).error.code).toBe(-32601)
    await app.close()
  })

  it('returns an RFC 7807 problem for a malformed JSON-RPC envelope', async () => {
    const { core } = setupMcpInMemory()
    const app = createMcpHttpApp(core)
    const response = await injectClient(app).post('/mcp', { not: 'jsonrpc' })
    expect(response.status).toBe(400)
    expectRFC7807(response.json, { status: 400, failureDomain: 'validation' })
    await app.close()
  })

  it('wraps a tool-call result in an MCP content block', async () => {
    const { core } = setupMcpInMemory()
    const app = createMcpHttpApp(core)
    const response = await injectClient(app).post('/mcp', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'content_getPost', arguments: { postId: VALID_POST_ID } },
    })
    const result = (response.json as { result: { content: unknown[] } }).result
    expect(Array.isArray(result.content)).toBe(true)
    await app.close()
  })

  it('serves /mcp without auth when no token is configured (back-compat)', async () => {
    const { core } = setupMcpInMemory()
    const app = createMcpHttpApp(core)
    const response = await injectClient(app).post('/mcp', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    })
    expect(response.status).toBe(200)
    await app.close()
  })

  it('rejects /mcp with an RFC 7807 401 when a token is set but absent/invalid', async () => {
    const { core } = setupMcpInMemory()
    const app = createMcpHttpApp(core, { authToken: 'sekret-token' })
    const request = injectClient(app)
    const missing = await request.post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(missing.status).toBe(401)
    expectRFC7807(missing.json, { status: 401, failureDomain: 'authentication' })
    const wrong = await request.post(
      '/mcp',
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { authorization: 'Bearer wrong-token' },
    )
    expect(wrong.status).toBe(401)
    await app.close()
  })

  it('accepts /mcp with the correct bearer token', async () => {
    const { core } = setupMcpInMemory()
    const app = createMcpHttpApp(core, { authToken: 'sekret-token' })
    const response = await injectClient(app).post(
      '/mcp',
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { authorization: 'Bearer sekret-token' },
    )
    expect(response.status).toBe(200)
    await app.close()
  })

  it('leaves /health open even when a token is configured', async () => {
    const { core } = setupMcpInMemory()
    const app = createMcpHttpApp(core, { authToken: 'sekret-token' })
    const response = await injectClient(app).get('/health')
    expect(response.status).toBe(200)
    await app.close()
  })
})

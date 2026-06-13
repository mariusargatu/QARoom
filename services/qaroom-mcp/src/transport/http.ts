import { makeProblem } from '@qaroom/contracts'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  type McpResourceDef,
  McpResourceOutcome,
  type McpToolDef,
  McpToolOutcome,
} from '../schema/mcp'
import type { McpCore } from '../server/core'
import type { McpClient } from './client'
import { dispatchRpc } from './rpc'

interface JsonRpcRequest {
  jsonrpc?: unknown
  id?: unknown
  method?: unknown
  params?: unknown
}

/** HTTP transport: a single JSON-RPC 2.0 endpoint over Fastify (the integration/contract surface). */
export function createMcpHttpApp(core: McpCore): FastifyInstance {
  const app = Fastify({ logger: false })

  app.get('/health', async () => ({ status: 'ok' }))

  // Unauthenticated by design (ADR-0006 read-first surface) — protect at the network layer.
  // MCP is request/response: JSON-RPC notifications (no `id`) are not supported, so `id` is always
  // echoed. Transport-level HTTP errors are RFC 7807; protocol-level errors use the JSON-RPC envelope.
  app.post('/mcp', async (request, reply) => {
    const body = (request.body ?? {}) as JsonRpcRequest
    const id = body.id ?? null
    if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
      const problem = makeProblem({
        slug: 'mcp-invalid-jsonrpc',
        title: 'Invalid JSON-RPC request',
        status: 400,
        failure_domain: 'validation',
        detail: 'The body must be a JSON-RPC 2.0 envelope with a string "method".',
      })
      return reply.status(400).header('content-type', 'application/problem+json').send(problem)
    }
    const { result, error } = await dispatchRpc(core, body.method, body.params)
    if (error) return reply.status(200).send({ jsonrpc: '2.0', id, error })
    return reply.status(200).send({ jsonrpc: '2.0', id, result })
  })

  return app
}

/** Adapts a JSON-RPC POST function into the shared McpClient, re-validating wire payloads. */
export type RpcPost = (body: unknown) => Promise<{ status: number; json: unknown }>

interface RpcEnvelope {
  result?: unknown
  error?: { code: number; message: string }
}

export function httpMcpClient(post: RpcPost): McpClient {
  let nextId = 0
  const call = async (method: string, params: unknown): Promise<unknown> => {
    nextId += 1
    const { json } = await post({ jsonrpc: '2.0', id: nextId, method, params })
    const envelope = json as RpcEnvelope
    if (envelope.error) throw new Error(envelope.error.message)
    return envelope.result
  }
  return {
    async listTools() {
      const result = (await call('tools/list', {})) as { tools: McpToolDef[] }
      return result.tools
    },
    async callTool(name, input) {
      const result = (await call('tools/call', { name, arguments: input })) as {
        structuredContent: unknown
      }
      return McpToolOutcome.parse(result.structuredContent)
    },
    async listResources() {
      const result = (await call('resources/list', {})) as { resources: McpResourceDef[] }
      return result.resources
    },
    async readResource(uri) {
      const result = (await call('resources/read', { uri })) as { structuredContent: unknown }
      return McpResourceOutcome.parse(result.structuredContent)
    },
  }
}

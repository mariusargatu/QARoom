import { timingSafeEqual } from 'node:crypto'
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

/** Constant-time bearer-token comparison (no early-exit length/lexicographic leak). */
function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export interface McpHttpOptions {
  /** When set, every `POST /mcp` must present `Authorization: Bearer <authToken>`. When unset/empty
   *  the surface is open (back-compat: in-cluster, network-protected). Wire from `QAROOM_MCP_TOKEN`. */
  authToken?: string
}

/** HTTP transport: a single JSON-RPC 2.0 endpoint over Fastify (the integration/contract surface). */
export function createMcpHttpApp(core: McpCore, options: McpHttpOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false })
  const authToken = options.authToken?.trim()

  // `/health` stays open (k8s probes); only the JSON-RPC surface is gated.
  app.get('/health', async () => ({ status: 'ok' }))

  // Bearer-token gate for the JSON-RPC surface. Read-first today, but `callTool` will gain a mutating
  // pass (ADR-0006), so the authn seam lands now: unset token → open (network-protected); set → every
  // /mcp call must present it, else an RFC 7807 401. Constant-time compare; failures never echo input.
  if (authToken) {
    app.addHook('onRequest', async (request, reply) => {
      if (request.method !== 'POST' || (request.url.split('?')[0] ?? '') !== '/mcp') return
      const header = request.headers.authorization ?? ''
      const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
      if (!presented || !tokenMatches(presented, authToken)) {
        const problem = makeProblem({
          slug: 'mcp-unauthenticated',
          title: 'Missing or invalid bearer token',
          status: 401,
          failure_domain: 'authentication',
          detail: 'POST /mcp requires `Authorization: Bearer <token>` (QAROOM_MCP_TOKEN is set).',
        })
        return reply
          .status(401)
          .header('content-type', 'application/problem+json')
          .header('www-authenticate', 'Bearer')
          .send(problem)
      }
    })
  }

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

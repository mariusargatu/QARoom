import {
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
} from '../manifest/build-manifest'
import type { McpCore } from '../server/core'

/**
 * The JSON-RPC 2.0 method dispatch, kept transport-free so the HTTP route is a thin shell.
 * Implements the read-first MCP method set: initialize, tools/list, tools/call,
 * resources/list, resources/read.
 */
export interface RpcResult {
  result?: unknown
  error?: { code: number; message: string }
}

/**
 * MCP `tools/call` results carry a `content[]` block (the spec-required shape) PLUS the
 * QARoom `structuredContent` outcome (the typed payload our own client reads). Emitting both
 * keeps the in-repo client working and a standards-compliant MCP client able to parse it.
 */
function toolCallResult(outcome: { ok: boolean }): RpcResult {
  return {
    result: {
      content: [{ type: 'text', text: JSON.stringify(outcome) }],
      isError: !outcome.ok,
      structuredContent: outcome,
    },
  }
}

function resourceReadResult(uri: string, outcome: { ok: boolean }): RpcResult {
  return {
    result: {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(outcome) }],
      isError: !outcome.ok,
      structuredContent: outcome,
    },
  }
}

export async function dispatchRpc(
  core: McpCore,
  method: string,
  params: unknown,
): Promise<RpcResult> {
  if (method === 'initialize') {
    return {
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
        capabilities: { tools: {}, resources: {} },
      },
    }
  }
  if (method === 'tools/list') return { result: { tools: core.listTools() } }
  if (method === 'tools/call') {
    const payload = params as { name?: unknown; arguments?: unknown }
    if (typeof payload?.name !== 'string') {
      return { error: { code: -32602, message: 'tools/call requires a string "name"' } }
    }
    const outcome = await core.callTool(payload.name, payload.arguments ?? {})
    return toolCallResult(outcome)
  }
  if (method === 'resources/list') return { result: { resources: core.listResources() } }
  if (method === 'resources/read') {
    const payload = params as { uri?: unknown }
    if (typeof payload?.uri !== 'string') {
      return { error: { code: -32602, message: 'resources/read requires a string "uri"' } }
    }
    const outcome = await core.readResource(payload.uri)
    return resourceReadResult(payload.uri, outcome)
  }
  return { error: { code: -32601, message: `method not found: ${method}` } }
}

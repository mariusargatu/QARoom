import type { McpResourceDef, McpResourceOutcome, McpToolDef, McpToolOutcome } from '../schema/mcp'

/**
 * The transport-facing surface both transports satisfy. The in-memory client calls the
 * core directly (FastMCP-style, for unit/property/golden tests); the HTTP client speaks
 * JSON-RPC. The same test assertions run over both — mirroring the `.test` / `.spec` split.
 */
export interface McpClient {
  listTools(): Promise<McpToolDef[]>
  callTool(name: string, input: unknown): Promise<McpToolOutcome>
  listResources(): Promise<McpResourceDef[]>
  readResource(uri: string): Promise<McpResourceOutcome>
}

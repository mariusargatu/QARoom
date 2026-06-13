import { buildResourceEntries } from '../registry/resources'
import { buildToolEntries } from '../registry/tools'
import { McpManifest } from '../schema/mcp'

/**
 * The MCP spec revision this server targets (ADR-0006). A bump here is a deliberate
 * contract change and the drift gate surfaces it — which is the point of pinning it.
 *
 * Dialect note: tool `input_schema`s are emitted via Zod's `openapi-3.0` target (JSON Schema
 * Draft 7), whereas MCP nominally expects 2020-12. In practice the tool schemas use only keywords
 * that are identical across both drafts (type, pattern, properties, required, additionalProperties,
 * minimum, items, maxLength), so a 2020-12 client accepts them unchanged. No `$schema` is stamped.
 */
export const MCP_PROTOCOL_VERSION = '2025-11-25'
export const MCP_SERVER_NAME = 'qaroom-mcp'
export const MCP_SERVER_VERSION = '0.1.0'

/**
 * Build the frozen manifest from the operation registries. Pure and byte-stable: the
 * manifest carries no wall-clock or snapshot id, so regenerate-and-diff (Gate 1) only
 * ever flags an intentional change to the tool/resource surface.
 */
export function buildManifest(): McpManifest {
  const tools = buildToolEntries().map((entry) => entry.def)
  const resources = buildResourceEntries().map((entry) => entry.def)
  return McpManifest.parse({
    protocol_version: MCP_PROTOCOL_VERSION,
    server: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    tools,
    resources,
  })
}

/** Deterministic serialization for the committed artifact + the drift gate. */
export function stringifyManifest(manifest: McpManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

import type { Clock, IdGenerator } from '@qaroom/determinism'

/**
 * The MCP core holds NO database. Its only outward edge is the ServiceClient seam:
 * production wires HTTP (fetch to the live gateway/content), tests wire a deterministic
 * fixture. This is the same record/replay shape the rest of QARoom uses — the core is
 * transport-agnostic and provably deterministic under seeded deps.
 */
export interface ServiceResponse {
  status: number
  contentType: string
  body: unknown
}

export interface ServiceClient {
  /** Proxy a read (GET) to a backing service. Path params are already substituted. */
  get(
    service: string,
    path: string,
    query?: Record<string, string | number>,
  ): Promise<ServiceResponse>
}

/**
 * Runtime determinism (ADR-0006): the MCP server is held to injected Clock + IdGenerator,
 * not the script-level latitude an offline tool would get. `served_at` and `request_id` on
 * every outcome come from here — which is why the Gate-3 golden transcript is byte-stable.
 */
export interface McpDeps {
  clock: Clock
  ids: IdGenerator
}

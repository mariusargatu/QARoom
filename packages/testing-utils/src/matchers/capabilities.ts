import { Capabilities, type OasOperation } from '@qaroom/contracts'

/**
 * Assert `/system/capabilities` exposes exactly the operations in the service's
 * registry — none silently omitted. Parses through the Capabilities contract, so
 * a response that violates the MCP-tool shape also fails here (Commitment 7).
 */
export function expectCapabilitiesCover(json: unknown, operations: readonly OasOperation[]): void {
  const ids = Capabilities.parse(json)
    .capabilities.map((c) => c.operation_id)
    .sort()
  const expected = operations.map((o) => o.operationId).sort()
  if (ids.join(',') !== expected.join(',')) {
    throw new Error(`capabilities [${ids}] do not cover registry [${expected}]`)
  }
}

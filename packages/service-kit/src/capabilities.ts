import {
  asOf,
  type Capabilities,
  type Capability,
  type LamportGate,
  type OasOperation,
  schemaRef,
} from '@qaroom/contracts'
import type { Clock } from '@qaroom/determinism'

/** Build an MCP-tool-shaped JSON Schema for one operation's inputs. */
export function operationInputSchema(op: OasOperation): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const p of op.params ?? []) {
    properties[p.name] = p.schema
    if (p.required) required.push(p.name)
  }
  if (op.requestBodyRef) {
    properties.body = schemaRef(op.requestBodyRef)
    required.push('body')
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

/** Derive the `/system/capabilities` payload from a service's operation registry (Commitment 7). */
export function buildCapabilities(
  service: string,
  operations: readonly OasOperation[],
  clock: Clock,
  lamport: LamportGate,
): Capabilities {
  const capabilities: Capability[] = operations.map((op) => ({
    operation_id: op.operationId,
    method: op.method.toUpperCase(),
    path: op.path,
    summary: op.summary,
    description: op.description,
    mutating: op.mutating,
    input_schema: operationInputSchema(op),
  }))
  return { service, capabilities, as_of: asOf(clock, lamport) }
}

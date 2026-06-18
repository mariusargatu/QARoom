import { z } from 'zod'
import { AsOf } from './lamport'
import type { OasOperation } from './openapi/builder'

/**
 * `GET /system/state` (Commitment 7). Current state of every model the service
 * runs. `models` is an open map — each milestone adds its own models.
 */
export const SystemState = z
  .object({
    service: z.string(),
    models: z.record(z.string(), z.unknown()),
    as_of: AsOf,
  })
  .meta({
    id: 'SystemState',
    description: 'Current observable state of every model the service runs.',
  })
export type SystemState = z.infer<typeof SystemState>

/**
 * `GET /system/capabilities` (Commitment 7). Operations the service exposes, in
 * MCP-tool-shaped form: each capability carries a JSON Schema `input_schema`.
 */
export const Capability = z
  .object({
    operation_id: z.string(),
    method: z.string(),
    path: z.string(),
    summary: z.string(),
    description: z.string(),
    mutating: z.boolean(),
    input_schema: z.record(z.string(), z.unknown()),
  })
  .meta({ id: 'Capability', description: 'An MCP-tool-shaped description of one operation.' })
export type Capability = z.infer<typeof Capability>

export const Capabilities = z
  .object({
    service: z.string(),
    capabilities: z.array(Capability),
    as_of: AsOf,
  })
  .meta({ id: 'Capabilities', description: 'All operations the service exposes, MCP-tool-shaped.' })
export type Capabilities = z.infer<typeof Capabilities>

/**
 * The `/system/state` + `/system/capabilities` operation pair every domain service exposes
 * identically (Commitment 7). service-kit wires the routes; each service spreads this into the
 * tail of its `OPERATIONS` registry, so the capabilities-completeness test still guards drift —
 * now from one source instead of five byte-identical copies that could diverge silently.
 *
 * The gateway keeps its OWN system-ops variant (gateway-specific wording + `getSystemLimits`) and
 * must NOT import this — its `/system/*` surface is deliberately distinct.
 */
export const SYSTEM_OPERATIONS: readonly OasOperation[] = [
  {
    operationId: 'getSystemState',
    method: 'get',
    path: '/system/state',
    summary: 'Observable state of every model',
    description:
      'Returns the current state of every model the service runs, with an as_of envelope (Commitment 7).',
    tags: ['system'],
    mutating: false,
    responses: [{ code: 200, description: 'Current observable state.', bodyRef: 'SystemState' }],
  },
  {
    operationId: 'getSystemCapabilities',
    method: 'get',
    path: '/system/capabilities',
    summary: 'Operations the service exposes',
    description: 'Returns every operation in MCP-tool-shaped form (Commitment 7).',
    tags: ['system'],
    mutating: false,
    responses: [{ code: 200, description: 'The capability list.', bodyRef: 'Capabilities' }],
  },
]

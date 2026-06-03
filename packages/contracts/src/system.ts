import { z } from 'zod'
import { AsOf } from './lamport'

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

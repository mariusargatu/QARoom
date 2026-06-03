import {
  asOf,
  Capabilities,
  type LamportGate,
  type OasOperation,
  SystemState,
} from '@qaroom/contracts'
import type { Clock } from '@qaroom/determinism'
import type { FastifyInstance } from 'fastify'
import { buildCapabilities } from './capabilities'

export interface SystemRoutesOptions {
  service: string
  clock: Clock
  lamport: LamportGate
  operations: readonly OasOperation[]
  /** Returns the per-model state for `/system/state`. Defaults to `{}`. */
  models?: () => Record<string, unknown> | Promise<Record<string, unknown>>
}

/**
 * Register `GET /system/state` and `GET /system/capabilities` (Commitment 7). Every
 * service wires these identically; only the `models` provider differs.
 */
export function registerSystemRoutes(app: FastifyInstance, opts: SystemRoutesOptions): void {
  app.get('/system/state', async (_req, reply) => {
    const models = opts.models ? await opts.models() : {}
    reply
      .code(200)
      .send(
        SystemState.parse({ service: opts.service, models, as_of: asOf(opts.clock, opts.lamport) }),
      )
  })

  app.get('/system/capabilities', async (_req, reply) => {
    reply
      .code(200)
      .send(
        Capabilities.parse(
          buildCapabilities(opts.service, opts.operations, opts.clock, opts.lamport),
        ),
      )
  })
}

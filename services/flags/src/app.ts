import { LamportGate } from '@qaroom/contracts'
import { activeSpanSink, registerTenantContext, xstateTransitionSink } from '@qaroom/otel'
import {
  registerHealthRoutes,
  registerProblemHandler,
  registerSystemRoutes,
} from '@qaroom/service-kit'
import { sql } from 'drizzle-orm'
import Fastify, { type FastifyInstance } from 'fastify'
import type { FlagsDeps, RouteDeps } from './deps'
import { registerFlagRoutes } from './flags'
import { OPERATIONS } from './operations'
import { countFlags } from './repository'

/**
 * Build a flags-service Fastify instance from injected dependencies (Commitment 6). A
 * `LamportGate` is created from the IdGenerator if absent, and the rollout transition sink
 * defaults to the OTel `xstate.transition` span emitter (tests inject a recording sink).
 * Cross-cutting wiring (RFC 7807, /system/state + /system/capabilities) comes from
 * @qaroom/service-kit.
 */
export function buildApp(deps: FlagsDeps): FastifyInstance {
  const lamport = deps.lamport ?? new LamportGate(deps.ids, deps.sink ?? activeSpanSink)
  const routeDeps: RouteDeps = {
    db: deps.db,
    clock: deps.clock,
    ids: deps.ids,
    randomness: deps.randomness,
    lamport,
    transitionSink: deps.transitionSink ?? xstateTransitionSink('rollout'),
  }

  const app = Fastify({ logger: false })
  registerTenantContext(app)
  registerProblemHandler(app)
  registerHealthRoutes(app, {
    service: 'flags',
    readiness: async () => {
      await deps.db.execute(sql`select 1`)
    },
  })
  registerFlagRoutes(app, routeDeps)
  registerSystemRoutes(app, {
    service: 'flags',
    clock: deps.clock,
    lamport,
    operations: OPERATIONS,
    models: async () => {
      const flags = await countFlags(deps.db)
      return { flags: { count: flags } }
    },
  })
  return app
}

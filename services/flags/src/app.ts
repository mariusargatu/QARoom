import { LamportGate } from '@qaroom/contracts'
import { dbReadiness } from '@qaroom/messaging'
import { activeSpanSink, xstateTransitionSink } from '@qaroom/otel'
import { buildServiceApp } from '@qaroom/service-kit'
import type { FastifyInstance } from 'fastify'
import { OPERATIONS } from './contract/operations'
import type { FlagsDeps, RouteDeps } from './deps'
import { countFlags } from './repository'
import { registerFlagRoutes } from './routes/flags'

/**
 * Build a flags-service Fastify instance from injected dependencies (Commitment 6). A
 * `LamportGate` is created from the IdGenerator if absent, and the rollout transition sink
 * defaults to the OTel `xstate.transition` span emitter (tests inject a recording sink).
 * The canonical cross-cutting shell (tenant ctx -> RFC 7807 -> health -> /system/state +
 * /system/capabilities -> snapshot) comes from @qaroom/service-kit's `buildServiceApp`.
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

  return buildServiceApp({
    service: 'flags',
    clock: deps.clock,
    lamport,
    operations: OPERATIONS,
    readiness: dbReadiness(deps.db),
    snapshotStore: deps.snapshotStore,
    models: async () => {
      const flags = await countFlags(deps.db)
      return { flags: { count: flags } }
    },
    registerRoutes: (app) => {
      registerFlagRoutes(app, routeDeps)
    },
  })
}

import { LamportGate } from '@qaroom/contracts'
import { dbReadiness } from '@qaroom/messaging'
import { activeSpanSink } from '@qaroom/otel'
import { buildServiceApp } from '@qaroom/service-kit'
import type { FastifyInstance } from 'fastify'
import type { DonationsDeps, RouteDeps } from './deps'
import { registerDonationRoutes } from './donations'
import { OPERATIONS } from './operations'
import { countDonations } from './repository'

/**
 * Build a donations-service Fastify instance from injected dependencies (Commitment 6). The
 * payment client is injected via `deps.payment` (the Microcks mock in-cluster, a stub in
 * tests). A `LamportGate` is created from the IdGenerator if absent. The cross-cutting shell
 * (tenant context -> RFC 7807 -> health -> /system/* -> snapshot) comes from buildServiceApp;
 * only the domain routes and the models() body diverge.
 */
export function buildApp(deps: DonationsDeps): FastifyInstance {
  const lamport = deps.lamport ?? new LamportGate(deps.ids, deps.sink ?? activeSpanSink)
  const routeDeps: RouteDeps = {
    db: deps.db,
    clock: deps.clock,
    ids: deps.ids,
    randomness: deps.randomness,
    lamport,
    payment: deps.payment,
  }

  return buildServiceApp({
    service: 'donations',
    clock: deps.clock,
    lamport,
    operations: OPERATIONS,
    readiness: dbReadiness(deps.db),
    snapshotStore: deps.snapshotStore,
    models: async () => {
      const donations = await countDonations(deps.db)
      return { donations: { count: donations } }
    },
    registerRoutes: (app) => {
      registerDonationRoutes(app, routeDeps)
    },
  })
}

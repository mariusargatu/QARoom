import { LamportGate } from '@qaroom/contracts'
import { activeSpanSink, registerTenantContext } from '@qaroom/otel'
import {
  registerHealthRoutes,
  registerProblemHandler,
  registerSnapshotRoutes,
  registerSystemRoutes,
} from '@qaroom/service-kit'
import { sql } from 'drizzle-orm'
import Fastify, { type FastifyInstance } from 'fastify'
import type { DonationsDeps, RouteDeps } from './deps'
import { registerDonationRoutes } from './donations'
import { OPERATIONS } from './operations'
import { countDonations } from './repository'

/**
 * Build a donations-service Fastify instance from injected dependencies (Commitment 6). The
 * payment client is injected via `deps.payment` (the Microcks mock in-cluster, a stub in
 * tests). A `LamportGate` is created from the IdGenerator if absent.
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

  const app = Fastify({ logger: false })
  registerTenantContext(app)
  registerProblemHandler(app)
  registerHealthRoutes(app, {
    service: 'donations',
    readiness: async () => {
      await deps.db.execute(sql`select 1`)
    },
  })
  registerDonationRoutes(app, routeDeps)
  registerSystemRoutes(app, {
    service: 'donations',
    clock: deps.clock,
    lamport,
    operations: OPERATIONS,
    models: async () => {
      const donations = await countDonations(deps.db)
      return { donations: { count: donations } }
    },
  })
  registerSnapshotRoutes(app, {
    service: 'donations',
    clock: deps.clock,
    lamport,
    store: deps.snapshotStore,
  })
  return app
}

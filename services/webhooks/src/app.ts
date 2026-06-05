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
import type { RouteDeps, WebhooksDeps } from './deps'
import { OPERATIONS } from './operations'
import { countDeliveriesByStatus, countSubscriptions } from './repository'
import { registerWebhookRoutes } from './routes'

/**
 * Build a webhooks-service Fastify instance from injected dependencies (Commitment 6). This wires
 * the HTTP surface (subscription CRUD + system/snapshot) only — the NATS fan-out consumer and the
 * delivery worker are started in `server.ts` (live boot), so the app is testable in-process with
 * no broker. A `LamportGate` is created from the IdGenerator if absent.
 */
export function buildApp(deps: WebhooksDeps): FastifyInstance {
  const lamport = deps.lamport ?? new LamportGate(deps.ids, deps.sink ?? activeSpanSink)
  const routeDeps: RouteDeps = {
    db: deps.db,
    clock: deps.clock,
    ids: deps.ids,
    randomness: deps.randomness,
    lamport,
  }

  const app = Fastify({ logger: false })
  registerTenantContext(app)
  registerProblemHandler(app)
  registerHealthRoutes(app, {
    service: 'webhooks',
    readiness: async () => {
      await deps.db.execute(sql`select 1`)
    },
  })
  registerWebhookRoutes(app, routeDeps)
  registerSystemRoutes(app, {
    service: 'webhooks',
    clock: deps.clock,
    lamport,
    operations: OPERATIONS,
    models: async () => {
      // Independent reads — run concurrently.
      const [subscriptions, deliveries] = await Promise.all([
        countSubscriptions(deps.db),
        countDeliveriesByStatus(deps.db),
      ])
      return { subscriptions: { count: subscriptions }, deliveries }
    },
  })
  registerSnapshotRoutes(app, {
    service: 'webhooks',
    clock: deps.clock,
    lamport,
    store: deps.snapshotStore,
  })
  return app
}

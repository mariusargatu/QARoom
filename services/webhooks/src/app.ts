import { LamportGate } from '@qaroom/contracts'
import { dbReadiness } from '@qaroom/messaging'
import { activeSpanSink } from '@qaroom/otel'
import { buildServiceApp } from '@qaroom/service-kit'
import type { FastifyInstance } from 'fastify'
import { OPERATIONS } from './contract/operations'
import type { RouteDeps, WebhooksDeps } from './deps'
import { countDeliveriesByStatus, countSubscriptions } from './repository'
import { registerWebhookRoutes } from './routes/webhooks'

/**
 * Build a webhooks-service Fastify instance from injected dependencies (Commitment 6). This wires
 * the HTTP surface (subscription CRUD + system/snapshot) only — the NATS fan-out consumer and the
 * delivery worker are started in `server.ts` (live boot), so the app is testable in-process with
 * no broker. A `LamportGate` is created from the IdGenerator if absent. The cross-cutting shell
 * (tenant ctx -> RFC 7807 -> health -> routes -> /system/* -> snapshot) is composed by
 * `buildServiceApp`; webhooks composes a subset of its callbacks (readiness + models + a snapshot
 * store; no outbox).
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

  const app = buildServiceApp({
    service: 'webhooks',
    clock: deps.clock,
    lamport,
    operations: OPERATIONS,
    readiness: dbReadiness(deps.db),
    snapshotStore: deps.snapshotStore,
    models: async () => {
      // Independent reads — run concurrently.
      const [subscriptions, deliveries] = await Promise.all([
        countSubscriptions(deps.db),
        countDeliveriesByStatus(deps.db),
      ])
      return { subscriptions: { count: subscriptions }, deliveries }
    },
    registerRoutes: (app) => registerWebhookRoutes(app, routeDeps),
  })

  // Accept a bodyless POST on the pure state-toggle routes (pause/resume) instead of 415ing it.
  // Default Fastify 415s any request that signals a body (Content-Length or Transfer-Encoding) with
  // no matching Content-Type. A toggle needs no body, so this catch-all drains an unknown/empty body
  // to `undefined`; the built-in JSON parser still handles create's typed body. It also makes the
  // routes verifiable: pact-core replays a bodyless request as `Transfer-Encoding: chunked` with an
  // empty chunk and no Content-Type, which the default would otherwise reject.
  app.addContentTypeParser('*', (_req, payload, done) => {
    payload.on('data', () => {})
    payload.on('end', () => done(null, undefined))
    payload.on('error', done)
  })

  return app
}

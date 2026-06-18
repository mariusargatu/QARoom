import type { LamportGate, OasOperation, SnapshotStore } from '@qaroom/contracts'
import type { Clock } from '@qaroom/determinism'
import { registerTenantContext } from '@qaroom/otel'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerHealthRoutes } from './health-routes'
import { registerProblemHandler } from './problem'
import { registerSnapshotRoutes } from './snapshot'
import { registerSystemRoutes } from './system-routes'

export interface ServiceAppOptions {
  service: string
  clock: Clock
  lamport: LamportGate
  operations: readonly OasOperation[]
  /** Mount the service's own domain routes. Called after the cross-cutting middleware, before /system/*. */
  registerRoutes: (app: FastifyInstance) => void
  /** Per-model state for `/system/state`. Defaults to `{}`. */
  models?: () => Record<string, unknown> | Promise<Record<string, unknown>>
  /** Readiness probe for `/ready`. Absent ⇒ always ready (the DB-less gateway passes nothing). */
  readiness?: () => Promise<void>
  /** Scenario-replay store; when present, `/system/snapshot` is mounted (Commitment 8). */
  snapshotStore?: SnapshotStore
}

/**
 * The canonical QARoom Fastify shell, assembled in its one correctness-relevant registrar order:
 *
 *   tenant context -> RFC 7807 handler -> health -> domain routes -> /system/state+capabilities -> snapshot
 *
 * Every service used to copy this 19-line sequence into its own `buildApp`; the order was load-bearing
 * (tenant scope must wrap the problem handler must wrap the routes) yet asserted only incidentally by
 * five separate boot tests. This is composition of registrars service-kit already exports — no new
 * indirection — so each service's `buildApp` shrinks to "wire deps, hand over my routes + models".
 * It stays DB-free (readiness is an injected callback), so the DB-less gateway reuses it too.
 */
export function buildServiceApp(opts: ServiceAppOptions): FastifyInstance {
  const app = Fastify({ logger: false })
  registerTenantContext(app)
  registerProblemHandler(app)
  registerHealthRoutes(app, { service: opts.service, readiness: opts.readiness })
  opts.registerRoutes(app)
  registerSystemRoutes(app, {
    service: opts.service,
    clock: opts.clock,
    lamport: opts.lamport,
    operations: opts.operations,
    models: opts.models,
  })
  registerSnapshotRoutes(app, {
    service: opts.service,
    clock: opts.clock,
    lamport: opts.lamport,
    store: opts.snapshotStore,
  })
  return app
}

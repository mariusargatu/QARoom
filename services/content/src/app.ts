import { LamportGate } from '@qaroom/contracts'
import { dbReadiness } from '@qaroom/messaging'
import { activeSpanSink } from '@qaroom/otel'
import { buildServiceApp } from '@qaroom/service-kit'
import type { FastifyInstance } from 'fastify'
import { NO_FAULTS } from './config/faults'
import { OPERATIONS } from './contract/operations'
import type { ContentDeps, RouteDeps } from './deps'
import { countRows } from './repository/counts'
import { registerFeedRoutes } from './routes/feed'
import { registerPostRoutes } from './routes/posts'
import { registerVoteRoutes } from './routes/votes'

/**
 * Build a content-service Fastify instance from injected dependencies. No globals
 * are read: clock, ids, randomness, db and the deliberate-bug `faults` all arrive via `deps`
 * (Commitment 6; faults default to all-off). A `LamportGate` is created from the IdGenerator if one
 * isn't supplied. The canonical shell (tenant context, RFC 7807, health, /system/state +
 * /system/capabilities, snapshot) comes from @qaroom/service-kit's buildServiceApp; only the domain
 * routes and the models() body diverge.
 */
export function buildApp(deps: ContentDeps): FastifyInstance {
  const lamport = deps.lamport ?? new LamportGate(deps.ids, deps.sink ?? activeSpanSink)
  // Keep the reference (do not copy): tests flip a mutable faults object between calls.
  const faults = deps.faults ?? NO_FAULTS
  const routeDeps: RouteDeps = {
    db: deps.db,
    clock: deps.clock,
    ids: deps.ids,
    randomness: deps.randomness,
    lamport,
    faults,
  }

  return buildServiceApp({
    service: 'content',
    clock: deps.clock,
    lamport,
    operations: OPERATIONS,
    readiness: dbReadiness(deps.db),
    snapshotStore: deps.snapshotStore,
    models: async () => {
      const counts = await countRows(deps.db)
      return { posts: { count: counts.posts }, votes: { count: counts.votes } }
    },
    registerRoutes: (app) => {
      registerPostRoutes(app, routeDeps)
      registerFeedRoutes(app, routeDeps)
      registerVoteRoutes(app, routeDeps)
    },
  })
}

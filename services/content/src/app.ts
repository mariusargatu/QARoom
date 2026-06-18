import { LamportGate } from '@qaroom/contracts'
import { dbReadiness } from '@qaroom/messaging'
import { activeSpanSink } from '@qaroom/otel'
import { buildServiceApp } from '@qaroom/service-kit'
import type { FastifyInstance } from 'fastify'
import type { ContentDeps, RouteDeps } from './deps'
import { registerFeedRoutes } from './feed'
import { OPERATIONS } from './operations'
import { registerPostRoutes } from './posts'
import { countRows } from './repository'
import { registerVoteRoutes } from './votes'

/**
 * Build a content-service Fastify instance from injected dependencies. No globals
 * are read: clock, ids, randomness and db all arrive via `deps` (Commitment 6).
 * A `LamportGate` is created from the IdGenerator if one isn't supplied. The canonical
 * shell (tenant context, RFC 7807, health, /system/state + /system/capabilities, snapshot)
 * comes from @qaroom/service-kit's buildServiceApp; only the domain routes and the models()
 * body diverge.
 */
export function buildApp(deps: ContentDeps): FastifyInstance {
  const lamport = deps.lamport ?? new LamportGate(deps.ids, deps.sink ?? activeSpanSink)
  const routeDeps: RouteDeps = {
    db: deps.db,
    clock: deps.clock,
    ids: deps.ids,
    randomness: deps.randomness,
    lamport,
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

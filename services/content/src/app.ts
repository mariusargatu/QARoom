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
import type { ContentDeps, RouteDeps } from './deps'
import { registerFeedRoutes } from './feed'
import { OPERATIONS } from './operations'
import { registerPostRoutes } from './posts'
import { countRows } from './repository'
import { registerVoteRoutes } from './votes'

/**
 * Build a content-service Fastify instance from injected dependencies. No globals
 * are read: clock, ids, randomness and db all arrive via `deps` (Commitment 6).
 * A `LamportGate` is created from the IdGenerator if one isn't supplied. Cross-cutting
 * wiring (RFC 7807, /system/state + /system/capabilities) comes from @qaroom/service-kit.
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

  const app = Fastify({ logger: false })
  registerTenantContext(app)
  registerProblemHandler(app)
  registerHealthRoutes(app, {
    service: 'content',
    readiness: async () => {
      await deps.db.execute(sql`select 1`)
    },
  })
  registerPostRoutes(app, routeDeps)
  registerFeedRoutes(app, routeDeps)
  registerVoteRoutes(app, routeDeps)
  registerSystemRoutes(app, {
    service: 'content',
    clock: deps.clock,
    lamport,
    operations: OPERATIONS,
    models: async () => {
      const counts = await countRows(deps.db)
      return { posts: { count: counts.posts }, votes: { count: counts.votes } }
    },
  })
  registerSnapshotRoutes(app, {
    service: 'content',
    clock: deps.clock,
    lamport,
    store: deps.snapshotStore,
  })
  return app
}

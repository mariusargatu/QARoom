import { LamportGate } from '@qaroom/contracts'
import { activeSpanSink, registerTenantContext } from '@qaroom/otel'
import {
  registerHealthRoutes,
  registerProblemHandler,
  registerSystemRoutes,
} from '@qaroom/service-kit'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  DEFAULT_AUTH_RATE_LIMIT,
  DEFAULT_RATE_LIMIT,
  type GatewayDeps,
  type GatewayRouteDeps,
} from './deps'
import { CommunityEventStream } from './event-stream'
import { OPERATIONS } from './operations/operations'
import { registerAuthRateLimit, registerRateLimit } from './resilience/rate-limit'
import { RateLimiter } from './resilience/rate-limiter'
import { registerDonationsRoutes } from './routes/donations-routes'
import { registerEventsRoute } from './routes/events-routes'
import { registerFlagsRoutes } from './routes/flags-routes'
import { registerIdentityRoutes } from './routes/identity-routes'
import { registerModerationRoutes } from './routes/moderation-routes'
import { registerProxyRoutes } from './routes/proxy-routes'
import { registerWebhooksRoutes } from './routes/webhooks-routes'
import { registerLimitsRoute } from './system'
import { registerWsUpgrade } from './ws-upgrade'

/**
 * Build the gateway Fastify instance from injected dependencies. The content client
 * (the Pact consumer), the determinism trio, and the rate-limit config arrive via
 * `deps`; no globals are read (Commitment 6). Cross-cutting wiring (RFC 7807,
 * /system/state + /system/capabilities) comes from @qaroom/service-kit.
 */
export function buildGatewayApp(deps: GatewayDeps): FastifyInstance {
  const lamport = deps.lamport ?? new LamportGate(deps.ids, deps.sink ?? activeSpanSink)
  const limiter = new RateLimiter(deps.clock, deps.rateLimit ?? DEFAULT_RATE_LIMIT)
  const authLimiter = new RateLimiter(deps.clock, deps.authRateLimit ?? DEFAULT_AUTH_RATE_LIMIT)
  const eventStream = deps.eventStream ?? new CommunityEventStream()
  const routeDeps: GatewayRouteDeps = {
    content: deps.content,
    tickets: deps.tickets,
    verifyToken: deps.verifyToken,
    clock: deps.clock,
    lamport,
    limiter,
    eventStream,
  }

  const app = Fastify({ logger: false })
  registerTenantContext(app)
  registerProblemHandler(app)
  registerHealthRoutes(app, { service: 'gateway' })
  registerRateLimit(app, limiter)
  // The credential endpoint's brute-force bucket runs after the general limiter, so an auth trip
  // is independent of (and tighter than) general traffic (OWASP API#2).
  registerAuthRateLimit(app, authLimiter)
  registerProxyRoutes(app, routeDeps)
  if (deps.donations) registerDonationsRoutes(app, routeDeps, deps.donations)
  if (deps.flags) registerFlagsRoutes(app, routeDeps, deps.flags)
  if (deps.webhooks) registerWebhooksRoutes(app, routeDeps, deps.webhooks)
  if (deps.identity) registerIdentityRoutes(app, routeDeps, deps.identity)
  if (deps.moderator) registerModerationRoutes(app, routeDeps, deps.moderator)
  registerEventsRoute(app, routeDeps)
  registerWsUpgrade(app, routeDeps)
  registerSystemRoutes(app, {
    service: 'gateway',
    clock: deps.clock,
    lamport,
    operations: OPERATIONS,
    models: () => ({ rate_limiter: { capacity: limiter.capacity } }),
  })
  registerLimitsRoute(app, routeDeps)
  return app
}

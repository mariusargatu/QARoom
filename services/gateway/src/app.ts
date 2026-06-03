import { LamportGate } from '@qaroom/contracts'
import { activeSpanSink, registerTenantContext } from '@qaroom/otel'
import {
  registerHealthRoutes,
  registerProblemHandler,
  registerSystemRoutes,
} from '@qaroom/service-kit'
import Fastify, { type FastifyInstance } from 'fastify'
import { DEFAULT_RATE_LIMIT, type GatewayDeps, type GatewayRouteDeps } from './deps'
import { OPERATIONS } from './operations'
import { registerProxyRoutes } from './proxy-routes'
import { registerRateLimit } from './rate-limit'
import { RateLimiter } from './rate-limiter'
import { registerLimitsRoute } from './system'

/**
 * Build the gateway Fastify instance from injected dependencies. The content client
 * (the Pact consumer), the determinism trio, and the rate-limit config arrive via
 * `deps`; no globals are read (Commitment 6). Cross-cutting wiring (RFC 7807,
 * /system/state + /system/capabilities) comes from @qaroom/service-kit.
 */
export function buildGatewayApp(deps: GatewayDeps): FastifyInstance {
  const lamport = deps.lamport ?? new LamportGate(deps.ids, deps.sink ?? activeSpanSink)
  const limiter = new RateLimiter(deps.clock, deps.rateLimit ?? DEFAULT_RATE_LIMIT)
  const routeDeps: GatewayRouteDeps = {
    content: deps.content,
    clock: deps.clock,
    ids: deps.ids,
    randomness: deps.randomness,
    lamport,
    limiter,
  }

  const app = Fastify({ logger: false })
  registerTenantContext(app)
  registerProblemHandler(app)
  registerHealthRoutes(app, { service: 'gateway' })
  registerRateLimit(app, limiter)
  registerProxyRoutes(app, routeDeps)
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

import { asOf, SystemLimits } from '@qaroom/contracts'
import type { FastifyInstance } from 'fastify'
import type { GatewayRouteDeps } from './deps'
import { principalKey } from './resilience/rate-limit'

/** Gateway-specific observable endpoint: per-principal rate-limit usage. */
export function registerLimitsRoute(app: FastifyInstance, deps: GatewayRouteDeps): void {
  app.get('/system/limits', async (req, reply) => {
    const key = principalKey(req)
    const decision = deps.limiter.peek(key)
    const limits = SystemLimits.parse({
      service: 'gateway',
      principal: key,
      limit: deps.limiter.capacity,
      remaining: decision.remaining,
      reset_in_seconds: decision.secondsToFull,
      as_of: asOf(deps.clock, deps.lamport),
    })
    reply.code(200).send(limits)
  })
}

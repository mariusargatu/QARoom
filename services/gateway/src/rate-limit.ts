import { problem } from '@qaroom/service-kit'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { RateLimiter } from './rate-limiter'

/**
 * Principal identity for rate limiting. Milestone 1 has no JWT, so the principal is
 * the `X-Principal-Id` header, falling back to the client IP. Swaps to the JWT
 * `sub` claim in Milestone 2 with no change to the limiter.
 */
export function principalKey(req: FastifyRequest): string {
  const header = req.headers['x-principal-id']
  const principal = Array.isArray(header) ? header[0] : header
  return principal ? `principal:${principal}` : `ip:${req.ip}`
}

/** Rate-limit the `/api/*` surface (not `/system/*`). 429 ⇒ RFC 7807 `rate_limit`. */
export function registerRateLimit(app: FastifyInstance, limiter: RateLimiter): void {
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return

    const decision = limiter.consume(principalKey(req))
    reply.header('x-ratelimit-limit', String(limiter.capacity))
    reply.header('x-ratelimit-remaining', String(decision.remaining))

    if (!decision.allowed) {
      throw problem({
        slug: 'rate-limited',
        title: 'Too many requests',
        status: 429,
        failure_domain: 'rate_limit',
        retryable: true,
        detail: 'Rate limit exceeded for this principal.',
        next_actions: [
          {
            verb: 'GET',
            href: '/system/limits',
            description: 'Inspect your current usage and reset time.',
          },
        ],
        headers: { 'retry-after': String(decision.retryAfterSec) },
      })
    }
  })
}

import { problem } from '@qaroom/service-kit'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { RateLimitDecision, RateLimiter } from './rate-limiter'

/**
 * Principal identity for rate limiting. The gateway REST plane is unauthenticated by
 * design (ADR-0022: the gateway fronts identity; edge auth is deliberately omitted), so
 * the principal is the `X-Principal-Id` header, falling back to the client IP. Keying on
 * an authenticated JWT `sub` belongs to the parked Milestone 13 (real edge credentials,
 * superseding ADR-0022) and needs no change to the limiter itself.
 */
export function principalKey(req: FastifyRequest): string {
  const header = req.headers['x-principal-id']
  const principal = Array.isArray(header) ? header[0] : header
  return principal ? `principal:${principal}` : `ip:${req.ip}`
}

/** The single RFC 7807 shape for a 429, so the general and auth buckets never restate it. */
function rateLimited(decision: RateLimitDecision, spec: { slug: string; detail: string }) {
  return problem({
    slug: spec.slug,
    title: 'Too many requests',
    status: 429,
    failure_domain: 'rate_limit',
    retryable: true,
    detail: spec.detail,
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

/** Rate-limit the `/api/*` surface (not `/system/*`). 429 ⇒ RFC 7807 `rate_limit`. */
export function registerRateLimit(app: FastifyInstance, limiter: RateLimiter): void {
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return

    const decision = limiter.consume(principalKey(req))
    reply.header('x-ratelimit-limit', String(limiter.capacity))
    reply.header('x-ratelimit-remaining', String(decision.remaining))

    if (!decision.allowed) {
      throw rateLimited(decision, {
        slug: 'rate-limited',
        detail: 'Rate limit exceeded for this principal.',
      })
    }
  })
}

/** The credential endpoint: session issuance (ADR-0022 — JWT issuance is the auth surface). */
const CREDENTIAL_PATH = '/api/sessions'

/**
 * A dedicated brute-force bucket for the credential endpoint (`POST /api/sessions`), separate from
 * and tighter than the general per-principal limiter (OWASP API#2, broken authentication). Auth
 * attempts ride their OWN budget so credential stuffing cannot hide inside generous general traffic:
 * the auth bucket can trip while the general one still has capacity, and vice-versa. The 429 carries a
 * distinct `auth-rate-limited` type so the auth trip is attributable, not confused with general 429s.
 */
export function registerAuthRateLimit(app: FastifyInstance, limiter: RateLimiter): void {
  app.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'POST') return
    if (req.url.split('?')[0] !== CREDENTIAL_PATH) return

    const decision = limiter.consume(principalKey(req))
    reply.header('x-auth-ratelimit-limit', String(limiter.capacity))
    reply.header('x-auth-ratelimit-remaining', String(decision.remaining))

    if (!decision.allowed) {
      throw rateLimited(decision, {
        slug: 'auth-rate-limited',
        detail: 'Too many authentication attempts for this principal; slow down.',
      })
    }
  })
}

import { problem } from '@qaroom/service-kit'
import type { FastifyReply } from 'fastify'
import type { GatewayRouteDeps } from '../deps'
import type { ClientResponse } from './upstream-call'

/**
 * The upstream identity a route forwards to. When the call throws — connection refused, a
 * timeout (experiment 07), or an open circuit breaker (experiment 06) — the gateway maps it
 * to one typed RFC 7807 502 `dependency_failure` rather than leaking the upstream's own 5xx.
 */
export interface Upstream {
  slug: string
  title: string
  detail: string
}

/** Call the upstream; map an unreachable upstream to a 502; pass a real response through. */
export async function forward(
  reply: FastifyReply,
  deps: GatewayRouteDeps,
  mutating: boolean,
  upstream: Upstream,
  call: () => Promise<ClientResponse>,
): Promise<void> {
  let result: ClientResponse
  try {
    result = await call()
  } catch {
    throw problem({
      slug: upstream.slug,
      title: upstream.title,
      status: 502,
      failure_domain: 'dependency_failure',
      detail: upstream.detail,
      retryable: true,
      next_actions: [
        { verb: 'GET', href: '/system/state', description: 'Check gateway and upstream status.' },
      ],
    })
  }
  if (mutating && result.status >= 200 && result.status < 300) deps.lamport.bump()
  reply.code(result.status)
  if (result.contentType) reply.header('content-type', result.contentType)
  reply.send(result.body)
}

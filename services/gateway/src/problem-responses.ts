import type { OasResponse } from '@qaroom/contracts'
import { problemResponse } from '@qaroom/contracts'
import { type UpstreamRef, upstreamTitle } from './upstreams'

/**
 * Gateway-LOCAL RFC 7807 envelopes shared across the gateway's four operation files. NOT a barrel:
 * a plain module imported directly by `operations.ts`, `identity-operations.ts`,
 * `webhooks-operations.ts` and `moderation-operations.ts`. The gateway-edge wording here is
 * deliberately distinct from the service-internal validation wording in `@qaroom/contracts` — the
 * gateway diverges on purpose, so these stay here and are NOT hoisted into contracts.
 */

/** The gateway-edge 400 (one wording for every proxied route). */
export const validation400: OasResponse = problemResponse(
  400,
  'validation-failed',
  'Request failed validation',
  'validation',
  { description: 'The request failed validation at the gateway edge.' },
)

/**
 * A 502 for any unreachable upstream: one factory, one call per proxied service.
 *
 * `retryable: true` + `failure_domain: 'dependency_failure'` are hardcoded ONLY because all six
 * current upstreams (content/donations/flags/identity/webhooks/moderator) share them — verified
 * identical. A future upstream that needs `retryable: false` must GROW a parameter here, not
 * hand-roll a seventh copy of the block this factory replaced.
 */
export function upstreamUnreachable502(ref: UpstreamRef, detail: string): OasResponse {
  return problemResponse(502, ref.slug, upstreamTitle(ref.service), 'dependency_failure', {
    description: detail,
    retryable: true,
  })
}

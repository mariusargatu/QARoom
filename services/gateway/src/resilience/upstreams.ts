/**
 * Single source for each proxied upstream's identity (slug + service name). The route's runtime 502
 * (`forward.ts`) and the OpenAPI 502 (`problem-responses.ts`) both derive their slug + title from
 * here so the two can never disagree; each keeps its own per-occurrence `detail` (RFC 7807 allows
 * per-occurrence detail, so the runtime vs doc wording divergence is intentional, not drift).
 */
export interface UpstreamRef {
  readonly slug: string
  readonly service: string
}

export const upstreamTitle = (service: string): string => `Upstream ${service} unavailable`

export const CONTENT_UPSTREAM: UpstreamRef = {
  slug: 'content-unreachable',
  service: 'content-service',
}
export const DONATIONS_UPSTREAM: UpstreamRef = {
  slug: 'donations-unreachable',
  service: 'donations-service',
}
export const FLAGS_UPSTREAM: UpstreamRef = { slug: 'flags-unreachable', service: 'flags-service' }
export const IDENTITY_UPSTREAM: UpstreamRef = {
  slug: 'identity-unreachable',
  service: 'identity-service',
}
export const WEBHOOKS_UPSTREAM: UpstreamRef = {
  slug: 'webhooks-unreachable',
  service: 'webhooks-service',
}
export const MODERATOR_UPSTREAM: UpstreamRef = {
  slug: 'moderator-unreachable',
  service: 'moderator-agent',
}

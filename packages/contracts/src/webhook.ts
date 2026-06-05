import { z } from 'zod'
import { CommunityId, EventId, WebhookDeliveryId, WebhookSubscriptionId } from './ids'

/**
 * Webhook contracts (Milestone 11). A subscription is a community-scoped registration of an
 * external HTTPS endpoint that wants QARoom's domain events delivered to it. Deliveries are
 * the per-(subscription × event) work items the webhooks-service drives to a terminal state.
 *
 * webhooks-service is a PURE CONSUMER of the five existing NATS events — it publishes nothing
 * and defines no new subject (avoids a delivery feedback loop, ADR-0019). The `secret` is
 * write-once: it is returned ONLY on create (`WebhookSubscriptionWithSecret`), never on reads.
 */

/**
 * The domain events a subscription can subscribe to — exactly the five QARoom events that
 * flow over NATS today (docs/05 §3). A closed enum so a subscription can never name an event
 * the platform does not emit, and so the fan-out consumer can validate `event_types` at write.
 */
export const WebhookEventType = z
  .enum([
    'post.created',
    'vote.cast',
    'flag.state.changed',
    'donation.state.changed',
    'moderation.decision.recorded',
  ])
  .meta({
    id: 'WebhookEventType',
    description: 'A QARoom domain event a webhook can subscribe to.',
  })
export type WebhookEventType = z.infer<typeof WebhookEventType>

/**
 * Subscription lifecycle (PascalCase nouns). `Active` delivers; `Paused` is operator-quiesced;
 * `Disabled` is the terminal auto-quarantine after repeated dead-letters. Active↔Paused is the
 * operator toggle (pause/resume); Active/Paused→Disabled is driven by the worker.
 */
export const WebhookSubscriptionStatus = z.enum(['Active', 'Paused', 'Disabled']).meta({
  id: 'WebhookSubscriptionStatus',
  description: 'Lifecycle status of a webhook subscription.',
})
export type WebhookSubscriptionStatus = z.infer<typeof WebhookSubscriptionStatus>

/**
 * Delivery lifecycle (PascalCase nouns). Identical to the `webhook-delivery` XState machine's
 * states — a test asserts they agree, so the API can never report an unreachable state.
 * `Delivered` and `DeadLettered` are terminal.
 */
export const WebhookDeliveryStatus = z
  .enum(['Pending', 'Delivering', 'Delivered', 'Retrying', 'DeadLettered'])
  .meta({
    id: 'WebhookDeliveryStatus',
    description: 'Lifecycle status of a single webhook delivery.',
  })
export type WebhookDeliveryStatus = z.infer<typeof WebhookDeliveryStatus>

/**
 * SSRF guard (ADR-0019). A delivery target must be a public HTTPS URL: accepting an arbitrary
 * URL the cluster will POST to is a server-side-request-forgery surface, so we reject non-https
 * schemes, embedded credentials, and hostnames that are (or obviously resolve to) loopback,
 * private, link-local (incl. the `169.254.169.254` cloud-metadata IP), CGNAT, or unique-local
 * addresses. This is a SYNTACTIC guard on literal hosts — DNS-rebinding (a public name that
 * later resolves private) is a documented follow-up handled at delivery time. Pure + property
 * tested: `isPublicHttpsUrl` is the single oracle the Zod refine and the service share.
 */
export function isPublicHttpsUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.username !== '' || url.password !== '') return false
  const host = url.hostname.toLowerCase().replace(/\.$/, '') // strip a trailing dot (localhost.)
  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) return false
  if (host.endsWith('.local')) return false
  // Cluster-internal service names. The worker runs in-cluster, so an `https://postgres.default.svc`
  // (or `…svc.cluster.local`, `…internal`) target is SSRF against internal infra — reject them.
  if (host.endsWith('.svc') || host.endsWith('.cluster.local') || host.endsWith('.internal')) {
    return false
  }

  // IPv6 literal arrives bracket-stripped from URL.hostname.
  if (host.includes(':')) return !isPrivateIpv6(host)
  // IPv4 literal (four dotted decimal octets).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return !isPrivateIpv4(host)
  // A DNS name we cannot resolve synchronously — accept syntactically; pin at delivery time.
  return true
}

function isPrivateIpv4(host: string): boolean {
  const octets = host.split('.').map((o) => Number.parseInt(o, 10))
  if (octets.length !== 4 || octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return true
  const [a = 0, b = 0] = octets
  if (a === 0 || a === 10 || a === 127) return true // unspecified, RFC1918 10/8, loopback
  if (a === 169 && b === 254) return true // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true // RFC1918 172.16/12
  if (a === 192 && b === 168) return true // RFC1918 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
  return false
}

function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '')
  if (h === '::1' || h === '::') return true // loopback, unspecified
  if (h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd')) return true // link-local, ULA
  // IPv4-mapped (::ffff:…) is a known SSRF bypass vector. The URL parser canonicalizes the
  // embedded v4 to hex (`::ffff:a00:1`), so a dotted-tail check is not enough — reject the
  // whole mapped family. Legitimate webhook targets use public DNS names, not mapped literals.
  if (h.startsWith('::ffff:')) return true
  return false
}

/** A delivery target URL: public HTTPS only (SSRF guard). */
export const WebhookUrl = z
  .string()
  .url()
  .refine(isPublicHttpsUrl, {
    message: 'must be a public https URL (no loopback/private/link-local hosts)',
  })
  .meta({ id: 'WebhookUrl', description: 'A public HTTPS delivery target (SSRF-guarded).' })

/** A webhook subscription as exposed on reads — never carries the signing `secret`. */
export const WebhookSubscription = z
  .object({
    id: WebhookSubscriptionId,
    community_id: CommunityId,
    url: WebhookUrl,
    event_types: z.array(WebhookEventType).min(1),
    status: WebhookSubscriptionStatus,
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  })
  .meta({
    id: 'WebhookSubscription',
    description: 'An outbound webhook subscription within a community.',
  })
export type WebhookSubscription = z.infer<typeof WebhookSubscription>

/**
 * The create response — the ONLY place the signing `secret` is revealed (write-once). The
 * caller must store it to verify the `X-QARoom-Signature` HMAC; QARoom never returns it again.
 */
export const WebhookSubscriptionWithSecret = WebhookSubscription.extend({
  secret: z.string().min(1),
}).meta({
  id: 'WebhookSubscriptionWithSecret',
  description: 'A newly created subscription, including the write-once signing secret.',
})
export type WebhookSubscriptionWithSecret = z.infer<typeof WebhookSubscriptionWithSecret>

/** Request body for createWebhook. `.strict()` matches OAS additionalProperties:false. */
export const CreateWebhookRequest = z
  .strictObject({
    url: WebhookUrl,
    event_types: z.array(WebhookEventType).min(1),
  })
  .meta({ id: 'CreateWebhookRequest', description: 'Body for createWebhook.' })
export type CreateWebhookRequest = z.infer<typeof CreateWebhookRequest>

/** A community's webhook subscriptions. */
export const WebhookSubscriptionList = z
  .object({ community_id: CommunityId, webhooks: z.array(WebhookSubscription) })
  .meta({ id: 'WebhookSubscriptionList', description: 'A community’s webhook subscriptions.' })
export type WebhookSubscriptionList = z.infer<typeof WebhookSubscriptionList>

/**
 * A single delivery attempt-ledger row, exposed read-only at `.../deliveries`. `attempt` and
 * `next_attempt_at` make the retry contract OBSERVABLE — a subscriber (or test) can see exactly
 * how the deterministic backoff schedule is unfolding.
 */
export const WebhookDelivery = z
  .object({
    id: WebhookDeliveryId,
    subscription_id: WebhookSubscriptionId,
    community_id: CommunityId,
    event_id: EventId,
    event_type: WebhookEventType,
    status: WebhookDeliveryStatus,
    attempt: z.number().int().nonnegative(),
    next_attempt_at: z.iso.datetime().nullable(),
    last_status_code: z.number().int().nullable(),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  })
  .meta({
    id: 'WebhookDelivery',
    description: 'One outbound delivery of an event to a subscription.',
  })
export type WebhookDelivery = z.infer<typeof WebhookDelivery>

/** A page of a subscription's deliveries, newest first. */
export const WebhookDeliveryList = z
  .object({ subscription_id: WebhookSubscriptionId, deliveries: z.array(WebhookDelivery) })
  .meta({ id: 'WebhookDeliveryList', description: 'A page of a subscription’s deliveries.' })
export type WebhookDeliveryList = z.infer<typeof WebhookDeliveryList>

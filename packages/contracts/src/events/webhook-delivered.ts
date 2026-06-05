import { z } from 'zod'
import { CommunityId, EventId, WebhookDeliveryId } from '../ids'
import { WebhookEventType } from '../webhook'

/**
 * The outbound webhook delivery envelope (Milestone 11, ADR-0019). This is the HTTP body QARoom
 * POSTs to a subscriber — the contract the *receiver* (the consumer) depends on, with QARoom as
 * the *provider*. It wraps the source domain event (`data`) with delivery metadata so a receiver
 * can dedupe (`delivery_id`), correlate (`event_id`), route (`event_type`), and scope
 * (`community_id`). `delivered_at` is the signed timestamp (bound into the HMAC). The signature,
 * timestamp, delivery id, and event id are ALSO sent as `X-QARoom-*` headers (webhook-signing.ts).
 *
 * `data` is the unmodified source-event payload; a cross-check test validates it against the five
 * event Zod schemas keyed by `event_type`, so the envelope cannot drift from the events it carries.
 */
export const WEBHOOK_DELIVERED_VERSION = 1

export const WebhookDeliveryEnvelope = z
  .object({
    delivery_id: WebhookDeliveryId,
    event_id: EventId,
    event_type: WebhookEventType,
    community_id: CommunityId,
    delivered_at: z.iso.datetime(),
    data: z.record(z.string(), z.unknown()),
  })
  .meta({
    id: 'WebhookDeliveryEnvelope',
    description: 'The HTTP body of an outbound webhook delivery.',
  })
export type WebhookDeliveryEnvelope = z.infer<typeof WebhookDeliveryEnvelope>

import { z } from 'zod'
import { currencyField, DonationStatus } from '../donation'
import { CommunityId, DonationId, EventId, UserId } from '../ids'

/**
 * Emitted when a donation's status changes — subject
 * `qaroom.donations.donation.<community_id>.changed` (Milestone 5).
 *
 * Self-sufficient: the gateway's WS/poll feed renders the donation from this payload alone.
 * `event_id` is the `IdGenerator`'s `evt_<ulid>` (doubles as `Nats-Msg-Id` + the consumer
 * `processed_events` key). Non-strict for forward compatibility (conventions §2); a breaking
 * change freezes the prior shape as `donation-state-changed.v1.ts`.
 */
export const DonationStateChangedEvent = z
  .object({
    event_id: EventId,
    community_id: CommunityId,
    donation_id: DonationId,
    donor_id: UserId,
    amount_cents: z.number().int().positive(),
    currency: currencyField(),
    status: DonationStatus,
    occurred_at: z.iso.datetime(),
  })
  .meta({
    id: 'DonationStateChangedEvent',
    description: "Emitted when a donation's status changes.",
  })
export type DonationStateChangedEvent = z.infer<typeof DonationStateChangedEvent>

/** Canonical event name — NATS header `event-name` and the AsyncAPI message name. */
export const DONATION_STATE_CHANGED_EVENT = 'donation.state.changed'
/** Schema version — NATS header `event-version`; bumped only on a breaking change. */
export const DONATION_STATE_CHANGED_VERSION = 1

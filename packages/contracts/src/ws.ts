import { z } from 'zod'
import { currencyField, DonationStatus } from './donation'
import { FlagKey, FlagState } from './flag'
import { CommunityId, DonationId, UserId } from './ids'

/**
 * WebSocket push protocol (Milestone 5, Commitment 11). The gateway pushes a `WsEnvelope` for
 * every flag-rollout or donation-state change in a community a client is connected to. Every
 * envelope a client receives over the socket is ALSO retrievable from the polling endpoint
 * (`GET /api/communities/:cid/events?after=<seq>`) — the parity test asserts the two paths
 * never diverge, so a client without WS support is never blind to an event.
 *
 * The two frame shapes map 1:1 from the NATS `flag.state.changed` / `donation.state.changed`
 * events, so the gateway builds an envelope straight from a consumed event without a callback.
 * `seq` is a per-community monotonic cursor a polling client passes as `after`. `occurred_at`
 * is the injected-clock stamp from the originating mutation, never wall-clock.
 */

const seqField = () => z.number().int().nonnegative()

const FlagChangedFrame = z.strictObject({
  type: z.literal('flag.state.changed'),
  seq: seqField(),
  community_id: CommunityId,
  occurred_at: z.iso.datetime(),
  flag_key: FlagKey,
  state: FlagState,
  enabled: z.boolean(),
})

const DonationChangedFrame = z.strictObject({
  type: z.literal('donation.state.changed'),
  seq: seqField(),
  community_id: CommunityId,
  occurred_at: z.iso.datetime(),
  donation_id: DonationId,
  donor_id: UserId,
  amount_cents: z.number().int().positive(),
  currency: currencyField(),
  status: DonationStatus,
})

/** A single server→client push frame, discriminated on `type`. This is the AsyncAPI WS message. */
export const WsEnvelope = z
  .discriminatedUnion('type', [FlagChangedFrame, DonationChangedFrame])
  .meta({ id: 'WsEnvelope', description: 'A server→client WebSocket push frame.' })
export type WsEnvelope = z.infer<typeof WsEnvelope>

/** A page of envelopes returned by the polling endpoint (the WS fallback path). */
export const EventPage = z
  .object({
    community_id: CommunityId,
    /** Envelopes with `seq` strictly greater than the requested cursor, oldest first. */
    events: z.array(WsEnvelope),
    /** The highest `seq` in this page (or the requested cursor if empty). */
    cursor: seqField(),
  })
  .meta({ id: 'EventPage', description: 'A page of push envelopes from the polling fallback.' })
export type EventPage = z.infer<typeof EventPage>

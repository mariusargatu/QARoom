import { z } from 'zod'
import { CommunityId, EventId, UserId } from '../ids'

/**
 * Emitted when a GDPR erasure is requested for a user — subject
 * `qaroom.identity.user.<community_id>.erased` (Milestone 13, ADR-0036).
 *
 * Identity owns the user registry, so it is the saga's orchestrator: on `DELETE /api/users/{id}`
 * it deletes its own user data and emits ONE of these per community the user belonged to (the
 * subject grammar fixes `community_id` at position 3, so each event is tenant-scoped — a downstream
 * consumer deletes exactly that community's slice of the user's data). A user-global erasure is thus
 * decomposed into per-tenant cascades, which keeps the messaging-layer tenancy boundary intact.
 *
 * `event_id` is the `IdGenerator`'s `evt_<ulid>`; it doubles as the `Nats-Msg-Id` and the consumer
 * `processed_events` dedup key, so a redelivered erasure is a no-op (DELETE is naturally idempotent,
 * and dedup makes the bookkeeping idempotent too). Non-strict on purpose — an additive optional field
 * stays forward-compatible for an older consumer (conventions §2). A breaking change would freeze the
 * prior shape as `user-erased.v1.ts`.
 */
export const UserErasedEvent = z
  .object({
    event_id: EventId,
    user_id: UserId,
    community_id: CommunityId,
    requested_at: z.iso.datetime(),
  })
  .meta({
    id: 'UserErasedEvent',
    description: 'Emitted when a user erasure is requested for a community.',
  })
export type UserErasedEvent = z.infer<typeof UserErasedEvent>

/** Canonical event name — NATS header `event-name` and the AsyncAPI message name. */
export const USER_ERASED_EVENT = 'user.erased'
/** Schema version — NATS header `event-version`; bumped only on a breaking change. */
export const USER_ERASED_VERSION = 1

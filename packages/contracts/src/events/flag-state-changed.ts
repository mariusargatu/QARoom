import { z } from 'zod'
import { FlagKey, FlagState, RolloutEventName } from '../flag'
import { CommunityId, EventId } from '../ids'

/**
 * Emitted when a feature-flag rollout transitions — subject
 * `qaroom.flags.flag.<community_id>.changed` (Milestone 5).
 *
 * Self-sufficient: a consumer (the gateway's WS/poll feed, donations-service's gating
 * cache) acts on `to_state`/`enabled` without calling back to flags-service. `event_id` is
 * the `IdGenerator`'s `evt_<ulid>`; it doubles as the `Nats-Msg-Id` and the consumer
 * `processed_events` key. Non-strict on purpose — an additive optional field stays
 * forward-compatible for an older consumer (conventions §2). A breaking change freezes the
 * prior shape as `flag-state-changed.v1.ts`.
 */
export const FlagStateChangedEvent = z
  .object({
    event_id: EventId,
    community_id: CommunityId,
    flag_key: FlagKey,
    from_state: FlagState,
    to_state: FlagState,
    rollout_event: RolloutEventName,
    /** The gating projection at `to_state` (true iff `to_state === 'Enabled'`). */
    enabled: z.boolean(),
    occurred_at: z.iso.datetime(),
  })
  .meta({ id: 'FlagStateChangedEvent', description: 'Emitted when a flag rollout transitions.' })
export type FlagStateChangedEvent = z.infer<typeof FlagStateChangedEvent>

/** Canonical event name — NATS header `event-name` and the AsyncAPI message name. */
export const FLAG_STATE_CHANGED_EVENT = 'flag.state.changed'
/** Schema version — NATS header `event-version`; bumped only on a breaking change. */
export const FLAG_STATE_CHANGED_VERSION = 1

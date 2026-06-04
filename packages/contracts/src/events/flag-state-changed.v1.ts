import { z } from 'zod'
import { CommunityId, EventId } from '../ids'

/**
 * FROZEN v1 shape of `FlagStateChangedEvent` (Milestone 5). Field schemas are INLINED (not
 * imported from `../flag`) so this record stays byte-stable even if `FlagState` /
 * `RolloutEventName` later gain members. The compat test asserts a current producer's output
 * still parses here (conventions §2). Deliberately NOT registered (`no .meta({ id })`) so it
 * never leaks into the generated AsyncAPI document.
 */
export const FlagStateChangedEventV1 = z.object({
  event_id: EventId,
  community_id: CommunityId,
  flag_key: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  from_state: z.enum(['Off', 'Enabling', 'Canary', 'Enabled', 'Disabling']),
  to_state: z.enum(['Off', 'Enabling', 'Canary', 'Enabled', 'Disabling']),
  rollout_event: z.enum([
    'EnableRequested',
    'CanaryConfirmed',
    'RolloutCompleted',
    'DisableRequested',
    'DisableCompleted',
    'RolloutAborted',
  ]),
  enabled: z.boolean(),
  occurred_at: z.iso.datetime(),
})
export type FlagStateChangedEventV1 = z.infer<typeof FlagStateChangedEventV1>

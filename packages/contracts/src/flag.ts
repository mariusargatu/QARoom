import { z } from 'zod'
import { CommunityId } from './ids'
import { AsOf } from './lamport'

/**
 * Feature-flag contracts (Milestone 5). A flag is resolved per-community; its value is
 * not a raw boolean but the current state of a rollout state machine (see
 * `machines/rollout.machine.ts`). `enabled` is the projection the rest of the system gates
 * on. The rollout is advanced through explicit events, never by writing a state directly —
 * the machine is the single authority on which transitions are legal (ADR-0012).
 */

/**
 * A flag key is a slug, not a branded ULID id: flags are human-named, well-known, and
 * stable (`donations`, `dark-mode`), so the key IS the identifier within a community.
 * Lowercase, hyphen-separated, 2–64 chars. Lands as the OpenAPI path-param `pattern`.
 */
export const FlagKey = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,63}$/, 'must be a lowercase hyphen-separated slug (2–64 chars)')
  .meta({ id: 'FlagKey', description: 'A lowercase, hyphen-separated feature-flag key.' })
export type FlagKey = z.infer<typeof FlagKey>

/**
 * The rollout state. PascalCase nouns, identical to the XState machine's state names —
 * `machines/rollout.machine.ts` pins this set, and a contracts test asserts the two agree
 * so the API can never report a state the machine cannot reach.
 */
export const FlagState = z
  .enum(['Off', 'Enabling', 'Canary', 'Enabled', 'Disabling'])
  .meta({ id: 'FlagState', description: 'Current state of a feature-flag rollout.' })
export type FlagState = z.infer<typeof FlagState>

/**
 * The rollout-advancing events a client may request. PascalCase verbs, identical to the
 * machine's event union. The flags-service applies one of these against the current state
 * via the rollout runner; an event illegal from the current state is a 409 conflict, not a
 * silent no-op — the machine decides, not the handler.
 */
export const RolloutEventName = z
  .enum([
    'EnableRequested',
    'CanaryConfirmed',
    'RolloutCompleted',
    'DisableRequested',
    'DisableCompleted',
    'RolloutAborted',
  ])
  .meta({
    id: 'RolloutEventName',
    description: 'A rollout state-machine event a client may request.',
  })
export type RolloutEventName = z.infer<typeof RolloutEventName>

/** The resolved value of a flag for one community, with a read envelope. */
export const FlagResolution = z
  .object({
    community_id: CommunityId,
    flag_key: FlagKey,
    state: FlagState,
    /** The boolean the system gates on. `true` iff the rollout has reached `Enabled`. */
    enabled: z.boolean(),
    as_of: AsOf,
  })
  .meta({ id: 'FlagResolution', description: 'Resolved feature-flag value for a community.' })
export type FlagResolution = z.infer<typeof FlagResolution>

/** Request body for advanceRollout. `.strict()` matches OAS additionalProperties:false. */
export const AdvanceRolloutRequest = z.strictObject({ event: RolloutEventName }).meta({
  id: 'AdvanceRolloutRequest',
  description: 'Body for advanceRollout: the rollout event to apply.',
})
export type AdvanceRolloutRequest = z.infer<typeof AdvanceRolloutRequest>

/** A list of resolved flags for a community (the listFlags response). */
export const FlagList = z
  .object({ community_id: CommunityId, flags: z.array(FlagResolution), as_of: AsOf })
  .meta({ id: 'FlagList', description: 'All resolved flags for a community.' })
export type FlagList = z.infer<typeof FlagList>

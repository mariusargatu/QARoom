import { type FlagState, type RolloutEventName, rolloutMachine } from '@qaroom/contracts'

/**
 * The events legal from a flag state, read from the SAME rollout machine the server drives — so the
 * UI can only offer transitions the machine (and therefore the server) will accept. Single source
 * of legal transitions on the client side, shared by `useRollout` and the flags screen.
 */
export function legalEventsFor(state: FlagState): RolloutEventName[] {
  // A constructed XState machine always exposes a `states` map; the `?? {}` fallback is unreachable
  // without mutating the imported machine (defensive). The `?? {}` one line down IS exercised.
  const states =
    /* v8 ignore next -- defensive: rolloutMachine.config.states is always defined */
    rolloutMachine.config.states ?? {}
  const on = (states[state] as { on?: Record<string, unknown> } | undefined)?.on ?? {}
  return Object.keys(on) as RolloutEventName[]
}

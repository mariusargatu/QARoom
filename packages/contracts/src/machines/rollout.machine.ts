import { setup } from 'xstate'

/**
 * The donation-rollout state machine (Milestone 5 — the project's core demonstration).
 * A feature flag's value per community is the current state of this machine, advanced only
 * through explicit events. The forward path is a gradual rollout; the reverse path disables.
 *
 *   Off --EnableRequested--> Enabling --CanaryConfirmed--> Canary --RolloutCompleted--> Enabled
 *   Enabling/Canary --RolloutAborted--> Off            (bail out before full enable)
 *   Enabled --DisableRequested--> Disabling --DisableCompleted--> Off
 *
 * DELIBERATELY invoke-free and context-free, exactly like `migration.machine.ts`. The
 * real I/O (persisting state, publishing the flag-changed event, the canary cohort timer)
 * happens in the flags-service repository, which drives this machine via `applyRolloutEvent`
 * (rollout.runner.ts) and records each transition to a sink that becomes an
 * `xstate.transition` OTel span. `@xstate/graph` 3 hard-rejects `invoke`/`after` and any
 * `context` explodes its BFS, so async/timer boundaries are modeled as explicit EVENTS — the
 * machine `@xstate/graph` traverses for MBT (ADR-0005) is THIS machine, unchanged. A guard
 * test (rollout.machine.test.ts) pins the no-invoke/no-after constraint.
 *
 * States are PascalCase nouns; events are PascalCase verbs (docs/05). The state names are
 * identical to `FlagState` and the event names to `RolloutEventName` (../flag.ts) — a test
 * asserts the three agree so the API can never report an unreachable state.
 */

export type RolloutState = 'Off' | 'Enabling' | 'Canary' | 'Enabled' | 'Disabling'

export type RolloutEvent =
  | { type: 'EnableRequested' }
  | { type: 'CanaryConfirmed' }
  | { type: 'RolloutCompleted' }
  | { type: 'DisableRequested' }
  | { type: 'DisableCompleted' }
  | { type: 'RolloutAborted' }

/**
 * Context is the EMPTY object on purpose. Per-rollout data (which cohort, who requested it,
 * clock stamp) lives in the flags-service rows and the runner's transition records, NOT in
 * machine context — the Milestone-5 constraint that keeps `@xstate/graph` traversal finite.
 */
export type RolloutContext = Record<string, never>

export const rolloutMachine = setup({
  types: {
    context: {} as RolloutContext,
    events: {} as RolloutEvent,
  },
}).createMachine({
  id: 'rollout',
  initial: 'Off',
  context: {},
  states: {
    Off: {
      on: { EnableRequested: { target: 'Enabling' } },
    },
    Enabling: {
      on: {
        CanaryConfirmed: { target: 'Canary' },
        RolloutAborted: { target: 'Off' },
      },
    },
    Canary: {
      on: {
        RolloutCompleted: { target: 'Enabled' },
        RolloutAborted: { target: 'Off' },
      },
    },
    Enabled: {
      // Not an XState `final` state: the reverse path Enabled → Disabling must stay enabled.
      on: { DisableRequested: { target: 'Disabling' } },
    },
    Disabling: {
      on: { DisableCompleted: { target: 'Off' } },
    },
  },
})

export type RolloutMachine = typeof rolloutMachine

/**
 * The gating projection: the rest of the system treats a flag as ON only once its rollout
 * has reached `Enabled`. `Canary` is intentionally NOT globally enabled — it is enabled for
 * a cohort, modeled outside this machine (donations-service gate). This single function is
 * the one place the boolean is derived, so the API, the event payload, and the UI agree.
 */
export function rolloutEnabled(state: RolloutState): boolean {
  return state === 'Enabled'
}

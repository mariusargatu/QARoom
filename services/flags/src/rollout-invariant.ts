import type { RolloutState } from '@qaroom/contracts'

/**
 * The runtime binding between spec/tla/Rollout.tla and the flags-service (ADR-0024, Phase 3; T19).
 *
 * Rollout.tla proves the rollout protocol holds under all interleavings; this is the SAME legal
 * committed-transition relation, projected onto the persisted `flags.state`. Unlike the webhook
 * delivery machine there is no in-memory leg to collapse, so the committed edges ARE the machine's
 * edges — `rollout-invariant.test.ts` derives the real edge set from `rolloutMachine` and asserts it
 * equals `LEGAL_ROLLOUT_EDGES`, so this projection can never silently drift from the one source.
 *
 * DELIBERATELY NOT wired into `repository.ts#advanceRollout`. The FLAGS_BUG_CANARY_MISROUTES
 * deliberate-bug (docs/spikes/07) persists a *coherent but illegal* `Enabling -> Enabled` commit —
 * skipping the Canary cohort phase — and the whole point of that demo is that only a test holding its
 * own model of the machine catches it (the stateful-PBT in services/flags/tests/mbt, and the
 * MBT×fault composition). A structural guard in the persist path would short-circuit the very bug the
 * demo exists to catch, so the live defence for that transfer fault is MBT; this assertion stands as
 * Rollout.tla's in-proc falsifier (its test plants exactly that `Enabling -> Enabled` edge and proves
 * the assertion reds). The spec-level twin is the commented `MisrouteCanary` action in Rollout.tla.
 */

export const LEGAL_ROLLOUT_EDGES: Readonly<Record<RolloutState, ReadonlySet<RolloutState>>> = {
  Off: new Set<RolloutState>(['Enabling']),
  Enabling: new Set<RolloutState>(['Canary', 'Off']),
  Canary: new Set<RolloutState>(['Enabled', 'Off']),
  Enabled: new Set<RolloutState>(['Disabling']),
  Disabling: new Set<RolloutState>(['Off']),
}

/**
 * Throw if a committed rollout transition is off-protocol vs Rollout.tla's `Next` relation —
 * an edge the rollout machine does not permit (e.g. the `Enabling -> Enabled` canary-skip).
 */
export function assertLegalRolloutTransition(from: RolloutState, to: RolloutState): void {
  if (!LEGAL_ROLLOUT_EDGES[from].has(to)) {
    throw new Error(
      `illegal rollout commit ${from} -> ${to} (off Rollout.tla Next relation / canary gate skipped)`,
    )
  }
}

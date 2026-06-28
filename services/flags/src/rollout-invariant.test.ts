import {
  applyRolloutEvent,
  FlagState,
  RolloutEventName,
  type RolloutState,
} from '@qaroom/contracts'
import { FakeClock } from '@qaroom/testing-utils/determinism'
import { describe, expect, it } from 'vitest'
import { assertLegalRolloutTransition, LEGAL_ROLLOUT_EDGES } from './rollout-invariant'

/**
 * The persisted-state projection of spec/tla/Rollout.tla's `Next` relation (ADR-0024, Phase 3; T19).
 *
 * The drift gate below derives the rollout machine's TRUE one-step edges by applying every
 * RolloutEventName from every FlagState through `applyRolloutEvent` — the same function the
 * flags-service drives in production — and asserts they equal `LEGAL_ROLLOUT_EDGES`, so the binding
 * can never silently diverge from the one source (the machine) or from Rollout.tla.
 */

const MODEL_CLOCK = new FakeClock()

// Map/filter only — no `if`/`try` (the no-conditional-in-test rule). For each state, the set of
// states reachable in one legal event is exactly the machine's outgoing edges from that state.
function machineEdges(): Record<RolloutState, ReadonlySet<RolloutState>> {
  const entries = FlagState.options.map((from): [RolloutState, ReadonlySet<RolloutState>] => [
    from,
    new Set<RolloutState>(
      RolloutEventName.options
        .map((event) => applyRolloutEvent(from, event, { clock: MODEL_CLOCK }))
        .filter((result) => result.changed)
        .map((result) => result.to),
    ),
  ])
  return Object.fromEntries(entries) as Record<RolloutState, ReadonlySet<RolloutState>>
}

function sortedEdges(
  edges: Record<RolloutState, ReadonlySet<RolloutState>>,
): Record<string, string[]> {
  return Object.fromEntries(Object.entries(edges).map(([from, tos]) => [from, [...tos].sort()]))
}

describe('assertLegalRolloutTransition (Rollout.tla binding)', () => {
  it('LEGAL_ROLLOUT_EDGES equals the rollout machine edges (drift gate: binding == machine == spec)', () => {
    expect(sortedEdges(LEGAL_ROLLOUT_EDGES)).toEqual(sortedEdges(machineEdges()))
  })

  it('accepts every legal committed edge of the rollout machine', () => {
    expect(() => assertLegalRolloutTransition('Off', 'Enabling')).not.toThrow()
    expect(() => assertLegalRolloutTransition('Enabling', 'Canary')).not.toThrow()
    expect(() => assertLegalRolloutTransition('Enabling', 'Off')).not.toThrow()
    expect(() => assertLegalRolloutTransition('Canary', 'Enabled')).not.toThrow()
    expect(() => assertLegalRolloutTransition('Canary', 'Off')).not.toThrow()
    expect(() => assertLegalRolloutTransition('Enabled', 'Disabling')).not.toThrow()
    expect(() => assertLegalRolloutTransition('Disabling', 'Off')).not.toThrow()
  })

  it('rejects the canary-skip transfer fault (the FLAGS_BUG_CANARY_MISROUTES Enabling -> Enabled edge)', () => {
    expect(() => assertLegalRolloutTransition('Enabling', 'Enabled')).toThrow(
      /illegal rollout commit/,
    )
  })

  it('rejects an edge out of a settled/illegal source', () => {
    expect(() => assertLegalRolloutTransition('Off', 'Canary')).toThrow(/illegal rollout commit/)
    expect(() => assertLegalRolloutTransition('Enabled', 'Off')).toThrow(/illegal rollout commit/)
  })
})

import type { Clock } from '@qaroom/determinism'
import { createActor } from 'xstate'
import { type RolloutEvent, type RolloutState, rolloutMachine } from './rollout.machine'

/**
 * One recorded rollout transition. `at` is stamped via the injected `clock.now()` — NEVER
 * `new Date()` (Commitment 6). This is the substrate the OTel `xstateTransitionSink`
 * (@qaroom/otel) turns into an always-sampled `xstate.transition` span, which Tracetest
 * reverse-conformance then checks against this machine's graph (ADR-0012).
 */
export interface RolloutTransitionRecord {
  from: RolloutState
  to: RolloutState
  event: RolloutEvent['type']
  at: string
}

/** No-op seam for emitting each transition as a span; mirrors the migration runner's sink. */
export interface RolloutTransitionSink {
  record(transition: RolloutTransitionRecord): void
}

const NOOP_TRANSITION_SINK: RolloutTransitionSink = {
  record() {
    /* no-op until a service wires the xstate.transition span */
  },
}

export interface ApplyRolloutOptions {
  clock: Clock
  sink?: RolloutTransitionSink
}

export interface RolloutApplyResult {
  from: RolloutState
  to: RolloutState
  event: RolloutEvent['type']
  /** False when the event is illegal from `from` (XState ignores it) — the caller returns 409. */
  changed: boolean
  /** Present only when `changed` — the recorded, clock-stamped transition. */
  transition?: RolloutTransitionRecord
}

/**
 * Apply a single rollout event to a flag currently in `currentState`, returning the
 * resulting state. The machine — not the caller — decides legality: an event with no
 * transition from `currentState` leaves the state unchanged (`changed: false`), which the
 * flags-service maps to a 409 conflict rather than a silent no-op. A real transition is
 * recorded with an injected clock stamp and emitted to the sink (the span seam). The actor
 * is started from `currentState` (not the machine's initial state) via `resolveState`, so
 * this is a pure function of (state, event) with no hidden history.
 */
export function applyRolloutEvent(
  currentState: RolloutState,
  event: RolloutEvent['type'],
  opts: ApplyRolloutOptions,
): RolloutApplyResult {
  const sink = opts.sink ?? NOOP_TRANSITION_SINK
  const actor = createActor(rolloutMachine, {
    snapshot: rolloutMachine.resolveState({ value: currentState, context: {} }),
  })
  actor.start()
  const from = actor.getSnapshot().value as RolloutState
  actor.send({ type: event } as RolloutEvent)
  const to = actor.getSnapshot().value as RolloutState
  actor.stop()

  const changed = to !== from
  if (!changed) {
    return { from, to, event, changed: false }
  }
  const transition: RolloutTransitionRecord = {
    from,
    to,
    event,
    at: opts.clock.now().toISOString(),
  }
  sink.record(transition)
  return { from, to, event, changed: true, transition }
}

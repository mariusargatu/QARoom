import type { Clock } from '@qaroom/determinism'
import { type AnyStateMachine, createActor } from 'xstate'

/**
 * One recorded state-machine transition, generic over the state/event string unions so every
 * machine shares a single shape (rollout, webhook-delivery, migration all alias it). `at` is
 * stamped via the injected `clock.now()` — NEVER `new Date()` (Commitment 6). This is the
 * substrate the OTel `xstateTransitionSink` (@qaroom/otel) turns into an always-sampled
 * `xstate.transition` span, which Tracetest reverse-conformance checks against the machine
 * graph (ADR-0012).
 */
export interface TransitionRecord<S extends string = string, E extends string = string> {
  from: S
  to: S
  event: E
  at: string
}

/** No-op-able seam for emitting each transition as a span; the OTel sink satisfies it structurally. */
export interface TransitionSink<S extends string = string, E extends string = string> {
  record(transition: TransitionRecord<S, E>): void
}

/** Shared no-op sink: keeps the seam without forcing every caller to wire a span emitter. */
export const NOOP_TRANSITION_SINK: TransitionSink = {
  record() {
    /* no-op until a service wires the xstate.transition span */
  },
}

export interface ApplyEventOptions<S extends string = string, E extends string = string> {
  clock: Clock
  sink?: TransitionSink<S, E>
}

export interface ApplyEventResult<S extends string, E extends string> {
  from: S
  to: S
  event: E
  /** False when the event is illegal from `from` (XState ignores it) — the caller decides 409 vs invariant. */
  changed: boolean
  /** Present only when `changed` — the recorded, clock-stamped transition. */
  transition?: TransitionRecord<S, E>
}

/**
 * Apply a single event to a machine currently in `currentState`, returning the resulting state.
 * The machine — not the caller — decides legality: an event with no transition from `currentState`
 * leaves the state unchanged (`changed: false`). A real transition is recorded with an injected
 * clock stamp and emitted to the sink. The actor is started from `currentState` (not the machine's
 * initial state) via `resolveState`, so this is a pure function of (state, event) with no hidden
 * history. The three per-machine runners wrap this with their typed state/event aliases.
 */
export function applyMachineEvent<S extends string, E extends string>(
  machine: AnyStateMachine,
  currentState: S,
  event: E,
  opts: ApplyEventOptions<S, E>,
): ApplyEventResult<S, E> {
  const sink = opts.sink ?? (NOOP_TRANSITION_SINK as TransitionSink<S, E>)
  const actor = createActor(machine, {
    snapshot: machine.resolveState({ value: currentState, context: {} }),
  })
  actor.start()
  const from = actor.getSnapshot().value as S
  actor.send({ type: event })
  const to = actor.getSnapshot().value as S
  actor.stop()

  const changed = to !== from
  if (!changed) {
    return { from, to, event, changed: false }
  }
  const transition: TransitionRecord<S, E> = {
    from,
    to,
    event,
    at: opts.clock.now().toISOString(),
  }
  sink.record(transition)
  return { from, to, event, changed: true, transition }
}

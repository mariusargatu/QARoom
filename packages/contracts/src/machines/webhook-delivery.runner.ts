import type { Clock } from '@qaroom/determinism'
import { createActor } from 'xstate'
import {
  type WebhookDeliveryEvent,
  type WebhookDeliveryStateName,
  webhookDeliveryMachine,
} from './webhook-delivery.machine'

/**
 * One recorded delivery transition. `at` is stamped via the injected `clock.now()` — NEVER
 * `new Date()` (Commitment 6). This is the substrate the OTel `xstateTransitionSink`
 * (@qaroom/otel) turns into an always-sampled `xstate.transition` span, which Tracetest
 * reverse-conformance then checks against this machine's graph (ADR-0012, ADR-0019).
 */
export interface WebhookDeliveryTransitionRecord {
  from: WebhookDeliveryStateName
  to: WebhookDeliveryStateName
  event: WebhookDeliveryEvent['type']
  at: string
}

/** No-op seam for emitting each transition as a span; mirrors the rollout runner's sink. */
export interface WebhookDeliveryTransitionSink {
  record(transition: WebhookDeliveryTransitionRecord): void
}

const NOOP_TRANSITION_SINK: WebhookDeliveryTransitionSink = {
  record() {
    /* no-op until the service wires the xstate.transition span */
  },
}

export interface ApplyWebhookDeliveryOptions {
  clock: Clock
  sink?: WebhookDeliveryTransitionSink
}

export interface WebhookDeliveryApplyResult {
  from: WebhookDeliveryStateName
  to: WebhookDeliveryStateName
  event: WebhookDeliveryEvent['type']
  /** False when the event is illegal from `from` (XState ignores it) — a P0 worker invariant. */
  changed: boolean
  /** Present only when `changed` — the recorded, clock-stamped transition. */
  transition?: WebhookDeliveryTransitionRecord
}

/**
 * Apply a single delivery event to a delivery currently in `currentState`, returning the
 * resulting state. The machine — not the caller — decides legality: an event with no transition
 * from `currentState` leaves the state unchanged (`changed: false`), which the worker treats as
 * a programming error (it should never drive an illegal edge), not a silent no-op. A real
 * transition is recorded with an injected clock stamp and emitted to the sink (the span seam).
 * The actor is started from `currentState` (not the machine's initial state) via `resolveState`,
 * so this is a pure function of (state, event) with no hidden history.
 */
export function applyWebhookDeliveryEvent(
  currentState: WebhookDeliveryStateName,
  event: WebhookDeliveryEvent['type'],
  opts: ApplyWebhookDeliveryOptions,
): WebhookDeliveryApplyResult {
  const sink = opts.sink ?? NOOP_TRANSITION_SINK
  const actor = createActor(webhookDeliveryMachine, {
    snapshot: webhookDeliveryMachine.resolveState({ value: currentState, context: {} }),
  })
  actor.start()
  const from = actor.getSnapshot().value as WebhookDeliveryStateName
  actor.send({ type: event } as WebhookDeliveryEvent)
  const to = actor.getSnapshot().value as WebhookDeliveryStateName
  actor.stop()

  const changed = to !== from
  if (!changed) {
    return { from, to, event, changed: false }
  }
  const transition: WebhookDeliveryTransitionRecord = {
    from,
    to,
    event,
    at: opts.clock.now().toISOString(),
  }
  sink.record(transition)
  return { from, to, event, changed: true, transition }
}

import { trace } from '@opentelemetry/api'

const tracer = trace.getTracer('@qaroom/otel')

/** The span name reverse-conformance keys on (Milestone 5, ADR-0012). */
export const XSTATE_TRANSITION_SPAN = 'xstate.transition'

/** The structural shape shared by RolloutTransitionRecord and MigrationTransitionRecord. */
export interface TransitionRecordLike {
  from: string
  to: string
  event: string
  at: string
}

/**
 * Build a transition sink that emits one `xstate.transition` span per recorded transition.
 * The returned object is structurally compatible with both `RolloutTransitionSink` and
 * `MigrationTransitionSink` (@qaroom/contracts) — identical `record()` shape — so a service
 * can pass it straight to `applyRolloutEvent`/`runMigration`.
 *
 * The span carries `xstate.{machine,from,to,event}` so Tracetest reverse-conformance can
 * check each observed transition against the model graph (ADR-0012). It is created as a
 * child of whatever request span is active, so the trace links the HTTP mutation to the
 * transition it caused. Paired with `XStateTransitionSampler` (start-telemetry) so a
 * head-sampling decision can never drop it. With the SDK off (tests) the tracer is a no-op.
 */
export function xstateTransitionSink(machine: string): { record(t: TransitionRecordLike): void } {
  return {
    record(t) {
      const span = tracer.startSpan(XSTATE_TRANSITION_SPAN)
      span.setAttribute('xstate.machine', machine)
      span.setAttribute('xstate.from', t.from)
      span.setAttribute('xstate.to', t.to)
      span.setAttribute('xstate.event', t.event)
      span.setAttribute('xstate.at', t.at)
      span.end()
    },
  }
}

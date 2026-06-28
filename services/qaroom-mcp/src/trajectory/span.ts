import { trace, XSTATE_TRANSITION_SPAN } from '@qaroom/otel'
import { MACHINE, type ToolTransition } from './model'

const tracer = trace.getTracer('@qaroom/qaroom-mcp')

/**
 * Agent-trajectory identity (Boundary 16, ADR-0032 / T21): every emitted tool-use transition is
 * attributable to one agent + session, so an out-of-loop observer (the reverse-conformance oracle, a
 * Tracetest assertion) can assert both are present across the whole trajectory. Byte-compatible with
 * the `agent.id` / `session.id` attributes the moderator trajectory already carries.
 */
export const AGENT_ID_ATTR = 'agent.id'
export const SESSION_ID_ATTR = 'session.id'

/**
 * Emit one `xstate.transition` span for a tool-use transition — the SAME span name + `xstate.*`
 * attributes the moderator trajectory and the XState services emit (ADR-0012), plus `agent.id` /
 * `session.id`. Reuses the OTel SDK's tracer, so with no provider installed (tests) it is a silent
 * no-op and the determinism rule holds; the in-memory provider in the trajectory spec asserts the attrs.
 */
export function emitToolTransitionSpan(transition: ToolTransition): void {
  const span = tracer.startSpan(XSTATE_TRANSITION_SPAN)
  span.setAttribute('xstate.machine', MACHINE)
  span.setAttribute('xstate.from', transition.from)
  span.setAttribute('xstate.to', transition.to)
  span.setAttribute('xstate.event', transition.event)
  span.setAttribute('xstate.at', transition.at)
  span.setAttribute(AGENT_ID_ATTR, transition.agent_id)
  span.setAttribute(SESSION_ID_ATTR, transition.session_id)
  span.end()
}

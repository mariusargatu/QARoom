import { trace } from '@opentelemetry/api'
import type { SpanAttributeSink } from '@qaroom/contracts'

/**
 * Bridges `LamportGate`'s `SpanAttributeSink` to the active OTel span — replacing the
 * Milestone-0 `NOOP_SINK`. When a mutating path bumps the gate, `qaroom.lamport` lands on
 * whatever span is in scope. With no active span (boot, or under test with the SDK off)
 * it is a silent no-op, so it is observationally identical to `NOOP_SINK` in tests.
 */
export const activeSpanSink: SpanAttributeSink = {
  setAttribute(key, value) {
    trace.getActiveSpan()?.setAttribute(key, value)
  },
}

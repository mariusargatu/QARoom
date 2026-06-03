import { type Span, SpanStatusCode, trace } from '@opentelemetry/api'

const tracer = trace.getTracer('@qaroom/otel')

/**
 * Wrap an async operation in a child span. Used for DB-call depth on the hot paths:
 * there is no actively-maintained OpenTelemetry auto-instrumentation for `postgres`
 * (porsager), so we add explicit spans at the repository seam rather than depend on a
 * stale community package (ADR-0009). The span is made active so the `TenantSpanProcessor`
 * stamps `tenant.id`. With the SDK off (tests) `getTracer` is a no-op tracer — safe.
 */
export function traced<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      return await fn(span)
    } catch (err) {
      span.recordException(err as Error)
      span.setStatus({ code: SpanStatusCode.ERROR })
      throw err
    } finally {
      span.end()
    }
  })
}

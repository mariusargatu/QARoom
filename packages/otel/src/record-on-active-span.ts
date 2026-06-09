import { SpanStatusCode, trace } from '@opentelemetry/api'

/**
 * Record an exception on the CURRENTLY ACTIVE span, normalizing non-`Error` throwables. For a
 * failure caught inside a live request/operation-span context where no `span` argument is in
 * scope — the shared RFC 7807 problem handler, a publish-listener guard, a WS `socket.send` —
 * since every QARoom service runs `Fastify({ logger: false })`, the span is the only sink.
 *
 * A no-op when there is no active span. A DETACHED callback (a bare `setInterval` tick or a
 * loop's `.catch`) has none, so `recordException` there is silently dropped — open an explicit
 * `traced(...)` span in that case instead of calling this.
 */
export function recordOnActiveSpan(err: unknown, opts?: { markError?: boolean }): void {
  const span = trace.getActiveSpan()
  if (!span) return
  span.recordException(err instanceof Error ? err : new Error(String(err)))
  if (opts?.markError) span.setStatus({ code: SpanStatusCode.ERROR })
}

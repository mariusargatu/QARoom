import type { Context } from '@opentelemetry/api'
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-base'

/** The attribute the probe stamps when armed — a denied key AND an email-shaped value, so either
 *  half of the PII detector ({@link findPiiInAttributes}) catches it. */
export const PII_LEAK_ATTR = 'user.email'
export const PII_LEAK_VALUE = 'leaked.user@example.com'

/**
 * The falsifiable seam for the `pii-free-spans` claim (ADR-0034). The real defense against PII in
 * telemetry is the OpenTelemetry Collector's redaction processor (deploy/observability/otel-collector.yaml,
 * known-PII keys scrubbed before export); spans never carry user PII in the first place. This in-process
 * probe is the deliberate-bug toggle that proves the PII-in-spans AUDIT has teeth: armed, it stamps an
 * email-shaped attribute onto every span, so `pnpm check:pii-spans` (and the in-process gate) MUST go
 * red — the mirror of CHAOS_TENANT_SPAN_DROP, which proves the tenant.id audit has teeth.
 *
 * Read per-span from `process.env` (live-pod armable) and NODE_ENV-gated so it can never inject PII on
 * a production pod even if the env leaks in — a PII-injection switch is one you want inert in prod.
 */
export class PiiLeakProbe implements SpanProcessor {
  onStart(span: Span, _parentContext: Context): void {
    if (process.env.NODE_ENV !== 'production' && process.env.CHAOS_SPAN_PII === '1') {
      span.setAttribute(PII_LEAK_ATTR, PII_LEAK_VALUE)
    }
  }
  onEnd(_span: ReadableSpan): void {}
  async forceFlush(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

import type { Context } from '@opentelemetry/api'
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-base'
import { currentTenant } from './tenant-context'

/** Span attribute key for the tenancy discriminator (community_id) — Commitment 9. */
export const TENANT_ID_ATTR = 'tenant.id'

/**
 * Stamps `tenant.id` on EVERY span at start, read from the ambient tenant
 * (AsyncLocalStorage). Using `onStart` (not a Fastify response hook) is load-bearing:
 * only `onStart` fires for every span the SDK creates — HTTP roots, child DB spans,
 * outbound calls — so no span can slip through without `tenant.id`. Satisfies the
 * Milestone-3 exit criterion that a span missing `tenant.id` fails the CI conformance check.
 */
export class TenantSpanProcessor implements SpanProcessor {
  onStart(span: Span, _parentContext: Context): void {
    span.setAttribute(TENANT_ID_ATTR, currentTenant())
  }
  onEnd(_span: ReadableSpan): void {}
  async forceFlush(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

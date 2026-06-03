import { context, propagation, trace } from '@opentelemetry/api'

/**
 * Manual W3C trace-context propagation over a string carrier (Milestone 3 seed of the
 * `@qaroom/messaging` SDK). HTTP headers and NATS headers are both `Record<string,string>`,
 * so the same primitives carry context over sync HTTP now and async NATS in Milestone 4.
 */

/** Inject the active trace context into a carrier (mutates + returns it). */
export function injectTraceContext(carrier: Record<string, string> = {}): Record<string, string> {
  propagation.inject(context.active(), carrier)
  return carrier
}

/** Extract trace context from a carrier; returns the OTel Context to run downstream work within. */
export function extractTraceContext(carrier: Record<string, string>) {
  return propagation.extract(context.active(), carrier)
}

export { context, trace }

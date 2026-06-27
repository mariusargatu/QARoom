export { SpanStatusCode } from '@opentelemetry/api'
export {
  CONSUMER_LAG_METRIC,
  type ConsumerLagPoint,
  type ConsumerLagSource,
  consumerLagPoints,
  registerConsumerLagMetrics,
} from './consumer-lag-metrics'
export { registerTenantContext } from './fastify-tenant-plugin'
export { activeSpanSink } from './lamport-sink'
export {
  attributeLeaksPii,
  EMAIL_RE,
  findPiiInAttributes,
  PII_ATTR_DENYLIST,
  valueLooksLikePii,
} from './pii'
export {
  PII_LEAK_ATTR,
  PII_LEAK_VALUE,
  PiiLeakProbe,
} from './pii-leak-probe'
export { startServicePreload } from './preload'
export { context, extractTraceContext, injectTraceContext, trace } from './propagation'
export { recordOnActiveSpan } from './record-on-active-span'
export type { StartTelemetryOptions, TelemetryHandle } from './start-telemetry'
export { startTelemetry } from './start-telemetry'
export { currentTenant, SYSTEM_TENANT, tenantStore, withTenant } from './tenant-context'
export { TENANT_ID_ATTR, TenantSpanProcessor } from './tenant-span-processor'
export type { InMemoryTelemetry } from './test-telemetry'
export { startInMemoryTelemetry } from './test-telemetry'
export type { TracedSpan } from './traced'
export { traced } from './traced'
export { XStateTransitionSampler } from './xstate-sampler'
export { XSTATE_TRANSITION_SPAN, xstateTransitionSink } from './xstate-span'

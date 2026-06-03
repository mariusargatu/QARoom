import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'
import { TenantSpanProcessor } from './tenant-span-processor'

export interface TelemetryHandle {
  shutdown(): Promise<void>
}

export interface StartTelemetryOptions {
  serviceName: string
  /** OTLP collector base URL; defaults to `OTEL_EXPORTER_OTLP_ENDPOINT`. */
  otlpEndpoint?: string
  /** Defaults to `NODE_ENV !== 'test'` — the SDK is OFF under test so suites stay deterministic. */
  enabled?: boolean
}

const NOOP: TelemetryHandle = { async shutdown() {} }

/**
 * Start the OpenTelemetry NodeSDK for a service (Milestone 3). Must run from a `--import`
 * preload so http/fastify instrumentation patches before those modules are imported.
 * `TenantSpanProcessor` runs first (stamps `tenant.id` onStart); a `BatchSpanProcessor`
 * exports OTLP to the collector. No-op under test.
 */
export function startTelemetry(opts: StartTelemetryOptions): TelemetryHandle {
  const enabled = opts.enabled ?? process.env.NODE_ENV !== 'test'
  if (!enabled) return NOOP

  const endpoint = opts.otlpEndpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: opts.serviceName }),
    spanProcessors: [
      new TenantSpanProcessor(),
      new BatchSpanProcessor(
        new OTLPTraceExporter(endpoint ? { url: `${endpoint}/v1/traces` } : {}),
      ),
    ],
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(endpoint ? { url: `${endpoint}/v1/metrics` } : {}),
    }),
    instrumentations: [new HttpInstrumentation(), new FastifyInstrumentation()],
  })
  sdk.start()
  return { shutdown: () => sdk.shutdown() }
}

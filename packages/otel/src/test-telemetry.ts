import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { TenantSpanProcessor } from './tenant-span-processor'

export interface InMemoryTelemetry {
  exporter: InMemorySpanExporter
  shutdown(): Promise<void>
}

/**
 * A real tracer provider exporting to memory, WITH the TenantSpanProcessor — the
 * deterministic seam for the `tenant.id` conformance test and the package's unit tests.
 * `register()` also installs the default W3C propagator. Tests assert on span attributes,
 * never on trace/span IDs (which come from the OTel RNG and are out of determinism scope).
 */
export function startInMemoryTelemetry(): InMemoryTelemetry {
  const exporter = new InMemorySpanExporter()
  const provider = new NodeTracerProvider({
    spanProcessors: [new TenantSpanProcessor(), new SimpleSpanProcessor(exporter)],
  })
  provider.register()
  return { exporter, shutdown: () => provider.shutdown() }
}

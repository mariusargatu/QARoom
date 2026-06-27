import { trace } from '@opentelemetry/api'
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { findPiiInAttributes } from './pii'
import { PiiLeakProbe } from './pii-leak-probe'
import { withTenant } from './tenant-context'
import { TenantSpanProcessor } from './tenant-span-processor'

// A real in-memory provider WITH the PII leak probe + the tenant processor, so the gate scans the
// exact attributes the production pipeline would export.
const exporter = new InMemorySpanExporter()
const provider = new NodeTracerProvider({
  spanProcessors: [
    new TenantSpanProcessor(),
    new PiiLeakProbe(),
    new SimpleSpanProcessor(exporter),
  ],
})

beforeAll(() => {
  provider.register()
})
afterAll(async () => {
  await provider.shutdown()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

function spanAttributesFor(name: string): Record<string, unknown> {
  withTenant('comm_01HZY0K7M3QF8VN2J5RX9TB4CD', () => {
    trace.getTracer('test').startActiveSpan(name, (span) => {
      span.end()
    })
  })
  const span = exporter.getFinishedSpans().find((s) => s.name === name)
  return (span?.attributes ?? {}) as Record<string, unknown>
}

describe('PII-in-spans audit', () => {
  // The `pnpm prove pii-free-spans --break` guarantee test: armed with CHAOS_SPAN_PII the probe stamps
  // an email onto the span, the audit finds it, and this assertion fails (red). Unique, regex-safe name
  // for the `-t` filter.
  it('emits no span carrying PII', () => {
    exporter.reset()
    expect(findPiiInAttributes(spanAttributesFor('clean-op'))).toEqual([])
  })

  it('detects the injected email when the probe is armed', () => {
    vi.stubEnv('CHAOS_SPAN_PII', '1')
    exporter.reset()
    expect(findPiiInAttributes(spanAttributesFor('leaky-op'))).toContain('user.email')
  })

  it('stays clean (tenant.id is not PII) without the toggle', () => {
    exporter.reset()
    const attrs = spanAttributesFor('tenant-op')
    expect(attrs['tenant.id']).toBe('comm_01HZY0K7M3QF8VN2J5RX9TB4CD')
    expect(findPiiInAttributes(attrs)).toEqual([])
  })
})

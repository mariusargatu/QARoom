import { trace } from '@opentelemetry/api'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { SYSTEM_TENANT, withTenant } from './tenant-context'
import { TENANT_ID_ATTR } from './tenant-span-processor'
import { type InMemoryTelemetry, startInMemoryTelemetry } from './test-telemetry'

let tel: InMemoryTelemetry
beforeAll(() => {
  tel = startInMemoryTelemetry()
})
afterAll(async () => {
  await tel.shutdown()
})

describe('TenantSpanProcessor', () => {
  it('stamps every span started under withTenant with that community as tenant.id', () => {
    tel.exporter.reset()
    trace.getTracer('test').startActiveSpan('op', (span) => {
      span.end()
    })
    withTenant('comm_01HZY0K7M3QF8VN2J5RX9TB4CD', () => {
      trace.getTracer('test').startActiveSpan('tenant-op', (span) => {
        span.end()
      })
    })
    const spans = tel.exporter.getFinishedSpans()
    const tenantSpan = spans.find((s) => s.name === 'tenant-op')
    expect(tenantSpan?.attributes[TENANT_ID_ATTR]).toBe('comm_01HZY0K7M3QF8VN2J5RX9TB4CD')
  })

  it('stamps a span started with no tenant scope as the system sentinel', () => {
    tel.exporter.reset()
    trace.getTracer('test').startActiveSpan('system-op', (span) => {
      span.end()
    })
    const span = tel.exporter.getFinishedSpans().find((s) => s.name === 'system-op')
    expect(span?.attributes[TENANT_ID_ATTR]).toBe(SYSTEM_TENANT)
  })
})

describe('TenantSpanProcessor under CHAOS_TENANT_SPAN_DROP (deliberate-bug toggle)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('drops the tenant.id stamp entirely when the toggle is armed', () => {
    vi.stubEnv('CHAOS_TENANT_SPAN_DROP', '1')
    tel.exporter.reset()
    withTenant('comm_01HZY0K7M3QF8VN2J5RX9TB4CD', () => {
      trace.getTracer('test').startActiveSpan('dropped-op', (span) => {
        span.end()
      })
    })
    const span = tel.exporter.getFinishedSpans().find((s) => s.name === 'dropped-op')
    expect(span?.attributes[TENANT_ID_ATTR]).toBeUndefined()
  })

  it('keeps stamping when the toggle holds any value other than "1"', () => {
    vi.stubEnv('CHAOS_TENANT_SPAN_DROP', '0')
    tel.exporter.reset()
    withTenant('comm_01HZY0K7M3QF8VN2J5RX9TB4CD', () => {
      trace.getTracer('test').startActiveSpan('stamped-op', (span) => {
        span.end()
      })
    })
    const span = tel.exporter.getFinishedSpans().find((s) => s.name === 'stamped-op')
    expect(span?.attributes[TENANT_ID_ATTR]).toBe('comm_01HZY0K7M3QF8VN2J5RX9TB4CD')
  })
})

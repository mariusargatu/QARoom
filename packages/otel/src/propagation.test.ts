import { trace } from '@opentelemetry/api'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { injectTraceContext } from './propagation'
import { type InMemoryTelemetry, startInMemoryTelemetry } from './test-telemetry'

let tel: InMemoryTelemetry
beforeAll(() => {
  tel = startInMemoryTelemetry()
})
afterAll(async () => {
  await tel.shutdown()
})

describe('trace-context propagation', () => {
  it('injects a W3C traceparent header carrying the active span context', () => {
    const carrier = trace.getTracer('test').startActiveSpan('op', (span) => {
      const c = injectTraceContext({})
      span.end()
      return c
    })
    expect(carrier.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/)
  })
})

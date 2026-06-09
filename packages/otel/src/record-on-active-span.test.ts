import { SpanStatusCode, trace } from '@opentelemetry/api'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { recordOnActiveSpan } from './record-on-active-span'
import { type InMemoryTelemetry, startInMemoryTelemetry } from './test-telemetry'

let tel: InMemoryTelemetry
beforeAll(() => {
  tel = startInMemoryTelemetry()
})
afterAll(async () => {
  await tel.shutdown()
})
beforeEach(() => {
  tel.exporter.reset()
})

const finished = (name: string): ReadableSpan | undefined =>
  tel.exporter.getFinishedSpans().find((s) => s.name === name)

const exceptionEvents = (span: ReadableSpan | undefined) =>
  (span?.events ?? []).filter((e) => e.name === 'exception')

describe('recordOnActiveSpan', () => {
  it('is a no-op that does not throw when no span is active', () => {
    const call = () => recordOnActiveSpan(new Error('detached failure'))
    expect(call).not.toThrow()
    expect(tel.exporter.getFinishedSpans()).toHaveLength(0)
  })

  it('records the exception as a span event without marking status ERROR by default', () => {
    trace.getTracer('test').startActiveSpan('op', (span) => {
      recordOnActiveSpan(new Error('boom'))
      span.end()
    })
    const span = finished('op')
    const events = exceptionEvents(span)
    expect(events).toHaveLength(1)
    expect(events[0]?.attributes?.['exception.message']).toBe('boom')
    expect(span?.status.code).not.toBe(SpanStatusCode.ERROR)
  })

  it('leaves the default UNSET status untouched when markError is omitted', () => {
    trace.getTracer('test').startActiveSpan('unset-op', (span) => {
      recordOnActiveSpan(new Error('boom'))
      span.end()
    })
    expect(finished('unset-op')?.status.code).toBe(SpanStatusCode.UNSET)
  })

  it('marks the active span status ERROR when markError is true', () => {
    trace.getTracer('test').startActiveSpan('err-op', (span) => {
      recordOnActiveSpan(new Error('fatal'), { markError: true })
      span.end()
    })
    expect(finished('err-op')?.status.code).toBe(SpanStatusCode.ERROR)
  })

  it('still records the exception event when markError is true', () => {
    trace.getTracer('test').startActiveSpan('err-event-op', (span) => {
      recordOnActiveSpan(new Error('fatal'), { markError: true })
      span.end()
    })
    const events = exceptionEvents(finished('err-event-op'))
    expect(events[0]?.attributes?.['exception.message']).toBe('fatal')
  })

  it('normalizes a non-Error throwable into an Error message on the recorded event', () => {
    trace.getTracer('test').startActiveSpan('string-op', (span) => {
      recordOnActiveSpan('plain string failure')
      span.end()
    })
    const events = exceptionEvents(finished('string-op'))
    expect(events).toHaveLength(1)
    expect(events[0]?.attributes?.['exception.message']).toBe('plain string failure')
  })
})

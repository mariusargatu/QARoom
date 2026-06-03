import { trace } from '@opentelemetry/api'
import { LamportGate } from '@qaroom/contracts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { activeSpanSink } from './lamport-sink'
import { type InMemoryTelemetry, startInMemoryTelemetry } from './test-telemetry'

const stubIds = { next: (prefix: string) => `${prefix}_stub` }

let tel: InMemoryTelemetry
beforeAll(() => {
  tel = startInMemoryTelemetry()
})
afterAll(async () => {
  await tel.shutdown()
})

describe('activeSpanSink', () => {
  it('writes qaroom.lamport onto the active span when the gate bumps', () => {
    tel.exporter.reset()
    const gate = new LamportGate(stubIds, activeSpanSink)
    trace.getTracer('test').startActiveSpan('write', (span) => {
      gate.bump()
      span.end()
    })
    const span = tel.exporter.getFinishedSpans().find((s) => s.name === 'write')
    expect(span?.attributes['qaroom.lamport']).toBe(1)
  })

  it('advances the lamport value without throwing when no span is active', () => {
    const gate = new LamportGate(stubIds, activeSpanSink)
    const tick = gate.bump()
    expect(tick.lamport).toBe(1)
  })
})

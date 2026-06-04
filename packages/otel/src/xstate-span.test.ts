import { ROOT_CONTEXT, SpanKind } from '@opentelemetry/api'
import { AlwaysOffSampler, SamplingDecision } from '@opentelemetry/sdk-trace-base'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type InMemoryTelemetry, startInMemoryTelemetry } from './test-telemetry'
import { XStateTransitionSampler } from './xstate-sampler'
import { XSTATE_TRANSITION_SPAN, xstateTransitionSink } from './xstate-span'

describe('xstateTransitionSink', () => {
  let telemetry: InMemoryTelemetry

  beforeEach(() => {
    telemetry = startInMemoryTelemetry()
  })
  afterEach(async () => {
    await telemetry.shutdown()
  })

  it('emits one xstate.transition span per recorded transition with the from/to/event attrs', () => {
    const sink = xstateTransitionSink('rollout')
    sink.record({
      from: 'Off',
      to: 'Enabling',
      event: 'EnableRequested',
      at: '2026-06-04T00:00:00.000Z',
    })

    const spans = telemetry.exporter.getFinishedSpans()
    expect(spans).toHaveLength(1)
    expect(spans[0]?.name).toBe(XSTATE_TRANSITION_SPAN)
    expect(spans[0]?.attributes).toMatchObject({
      'xstate.machine': 'rollout',
      'xstate.from': 'Off',
      'xstate.to': 'Enabling',
      'xstate.event': 'EnableRequested',
    })
  })
})

describe('XStateTransitionSampler', () => {
  const sample = (sampler: XStateTransitionSampler, name: string) =>
    sampler.shouldSample(ROOT_CONTEXT, 'trace-id', name, SpanKind.INTERNAL, {}, []).decision

  it('always samples an xstate.transition span even when the delegate would drop it', () => {
    // Delegate drops everything; the override must still sample the transition span.
    const sampler = new XStateTransitionSampler(new AlwaysOffSampler())
    expect(sample(sampler, XSTATE_TRANSITION_SPAN)).toBe(SamplingDecision.RECORD_AND_SAMPLED)
  })

  it('delegates the decision for any other span name', () => {
    const sampler = new XStateTransitionSampler(new AlwaysOffSampler())
    expect(sample(sampler, 'db.flags.advance')).toBe(SamplingDecision.NOT_RECORD)
  })
})

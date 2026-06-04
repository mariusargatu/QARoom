import type { Attributes, Context, Link, SpanKind } from '@opentelemetry/api'
import {
  AlwaysOnSampler,
  ParentBasedSampler,
  type Sampler,
  SamplingDecision,
  type SamplingResult,
} from '@opentelemetry/sdk-trace-base'
import { XSTATE_TRANSITION_SPAN } from './xstate-span'

/**
 * A sampler that ALWAYS samples `xstate.transition` spans and delegates every other span to
 * a wrapped sampler. Reverse conformance (ADR-0012) checks each observed transition against
 * the model graph; if head-based sampling dropped a transition span, a real off-model
 * transition could slip through unobserved. Forcing the per-span decision here keeps the
 * assertion sound regardless of the global sampling rate, and tail-based sampling can be
 * layered on later without touching this class.
 */
export class XStateTransitionSampler implements Sampler {
  readonly #delegate: Sampler

  constructor(delegate: Sampler = new ParentBasedSampler({ root: new AlwaysOnSampler() })) {
    this.#delegate = delegate
  }

  shouldSample(
    context: Context,
    traceId: string,
    spanName: string,
    spanKind: SpanKind,
    attributes: Attributes,
    links: Link[],
  ): SamplingResult {
    if (spanName === XSTATE_TRANSITION_SPAN) {
      return { decision: SamplingDecision.RECORD_AND_SAMPLED }
    }
    return this.#delegate.shouldSample(context, traceId, spanName, spanKind, attributes, links)
  }

  toString(): string {
    return `XStateTransitionSampler(${this.#delegate.toString()})`
  }
}

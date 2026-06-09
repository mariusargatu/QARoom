import { type InMemoryTelemetry, SpanStatusCode, startInMemoryTelemetry } from '@qaroom/otel'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { runResilientConsume } from './consume-loop'

// `traced` caches the module-level tracer on first use, so register ONE in-memory provider for the
// file and reset spans between tests (the relay.test.ts pattern; OTel registers the global once).
let telemetry: InMemoryTelemetry
beforeAll(() => {
  telemetry = startInMemoryTelemetry()
})
afterAll(() => telemetry.shutdown())
beforeEach(() => {
  telemetry.exporter.reset()
})

const raise = (message: string): never => {
  throw new Error(message)
}

/** A fake `consume()` iterator: yields `items` then ends; `stop()` is recorded for assertion. */
function fakeMessages<M>(items: M[]): AsyncIterable<M> & { stop: () => void; stopCalls: number } {
  return {
    stopCalls: 0,
    stop() {
      this.stopCalls += 1
    },
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item
    },
  }
}

/** A fake whose async iterator itself rejects (a broken connection / loop death). */
function explodingMessages(err: Error): AsyncIterable<number> & { stop: () => void } {
  return {
    stop() {},
    [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(err) }),
  }
}

function exceptionMessagesOn(spanName: string): string[] {
  return telemetry.exporter
    .getFinishedSpans()
    .filter((span) => span.name === spanName)
    .flatMap((span) => span.events)
    .filter((event) => event.name === 'exception')
    .map((event) => String(event.attributes?.['exception.message'] ?? ''))
}

describe('runResilientConsume keeps a consume loop alive across per-message failures', () => {
  it('processes every message even when one throws, settles only the failure, and records it on its span as ERROR', async () => {
    const handled: number[] = []
    const settled: Array<{ message: number; error: unknown }> = []
    const failers: Record<number, () => void> = { 2: () => raise('boom on 2') }
    const messages = fakeMessages([1, 2, 3])

    const stop = runResilientConsume<number>({
      messages,
      spanName: 'test.process',
      loopDeathSpanName: 'test.loop_died',
      handle: async (message) => {
        handled.push(message)
        ;(failers[message] ?? (() => {}))()
      },
      settle: (message, error) => settled.push({ message, error }),
    })
    await stop()

    // Loop continued past the throw on message 2.
    expect(handled).toEqual([1, 2, 3])
    // Only the failed message was settled (nak/term), with its error.
    expect(settled).toHaveLength(1)
    expect(settled[0]?.message).toBe(2)
    expect((settled[0]?.error as Error).message).toBe('boom on 2')
    // The failure is recorded on its per-message span, marked ERROR (not silently status-OK).
    expect(exceptionMessagesOn('test.process')).toEqual(['boom on 2'])
    const failedSpan = telemetry.exporter
      .getFinishedSpans()
      .find(
        (span) => span.name === 'test.process' && span.events.some((e) => e.name === 'exception'),
      )
    expect(failedSpan?.status.code).toBe(SpanStatusCode.ERROR)
  })

  it('does not settle a message that the handler processes successfully', async () => {
    const settled: number[] = []
    const messages = fakeMessages([1, 2])

    const stop = runResilientConsume<number>({
      messages,
      spanName: 'test.process',
      loopDeathSpanName: 'test.loop_died',
      handle: async () => {},
      settle: (message) => settled.push(message),
    })
    await stop()

    expect(settled).toEqual([])
  })

  it('surfaces a loop death (iterator rejection) on the loop-death span instead of an unhandled rejection', async () => {
    const messages = explodingMessages(new Error('iterator died'))

    const stop = runResilientConsume<number>({
      messages,
      spanName: 'test.process',
      loopDeathSpanName: 'test.loop_died',
      handle: async () => {},
      settle: () => {},
    })
    await stop()

    expect(exceptionMessagesOn('test.loop_died')).toContain('iterator died')
  })

  it('stopping the consumer halts the underlying message iterator exactly once', async () => {
    const messages = fakeMessages([1, 2])

    const stop = runResilientConsume<number>({
      messages,
      spanName: 'test.process',
      loopDeathSpanName: 'test.loop_died',
      handle: async () => {},
      settle: () => {},
    })
    await stop()

    expect(messages.stopCalls).toBe(1)
  })
})

import { context, extractTraceContext, SpanStatusCode, type TracedSpan, traced } from '@qaroom/otel'

export interface ResilientConsumeOpts<M> {
  /** A JetStream `consume()` iterator: async-iterable of messages with a `stop()`. */
  messages: AsyncIterable<M> & { stop: () => void }
  /** Span name for each per-message process attempt. */
  spanName: string
  /** Span name opened if the consume iterator ITSELF rejects (loop death). */
  loopDeathSpanName: string
  /** Optional: trace-context carrier headers for a message, restored before the per-message span. */
  traceCarrier?: (message: M) => Record<string, string>
  /** Process one message and ack it on success; THROW to signal failure (then `settle` runs). */
  handle: (message: M, span: TracedSpan) => Promise<void>
  /** Settle a FAILED message back to the broker (nak/term I/O). Runs after the exception is
   *  recorded on the span; must not throw. May be async — `settleByDeliveryBudget` writes a
   *  dead-letter row BEFORE terminating, and the loop must not race ahead of that write. */
  settle: (message: M, err: unknown) => void | Promise<unknown>
}

/**
 * Run a resilient JetStream consume loop, shared by the gateway WS feed and the webhooks fan-out
 * (each previously hand-rolled this). Each message is processed in its own `spanName` span; a
 * per-message failure is recorded on that LIVE span and settled via `settle` (nak/term) so the loop
 * CONTINUES instead of dying. If the consume iterator itself rejects (loop death), it is surfaced
 * on a fresh `loopDeathSpanName` span via `traced` — never `trace.getActiveSpan()`, which is
 * undefined in this detached `.catch` (a silent no-op) — so a dead consumer can't vanish while the
 * pod stays Ready. Returns a stop function that halts the iterator and awaits the loop.
 */
export function runResilientConsume<M>(opts: ResilientConsumeOpts<M>): () => Promise<void> {
  const runOne = (message: M): Promise<void> =>
    traced(opts.spanName, async (span) => {
      try {
        await opts.handle(message, span)
      } catch (err) {
        // We catch here to settle (nak/term) and keep the loop alive, so `traced`'s own
        // throw-driven ERROR status never fires — set it explicitly so a settled-failed message
        // reads as errored on its span (not status-OK) in Jaeger.
        span.recordException(err as Error)
        span.setStatus({ code: SpanStatusCode.ERROR })
        // Awaited: settle may persist a dead letter before it terms the message, and an
        // un-awaited call would let the loop (and a shutdown) race that write. A void-typed
        // callback silently swallowed the promise, which is exactly how the record could go
        // missing while the message was still terminated.
        await opts.settle(message, err)
      }
    })

  const loop = (async () => {
    for await (const message of opts.messages) {
      const carrier = opts.traceCarrier?.(message)
      if (carrier) await context.with(extractTraceContext(carrier), () => runOne(message))
      else await runOne(message)
    }
  })().catch((err: unknown) =>
    traced(opts.loopDeathSpanName, async () => {
      throw err
    }).catch(() => undefined),
  )

  return async () => {
    opts.messages.stop()
    await loop
  }
}

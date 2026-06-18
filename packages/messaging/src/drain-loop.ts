/**
 * The background-drain timer shell shared by the outbox relay and the webhooks delivery worker.
 * It owns exactly one discipline and nothing else: the loop is the ONLY timer, it is `unref`'d so
 * it never holds the process open, a rejected tick is swallowed so it can't become an unhandled
 * rejection, and `tick` (the caller's `drainOnce`) stays directly callable so tests drive it
 * deterministically without the timer.
 *
 * It deliberately takes a bare `tick` rather than a span name: the relay self-traces inside
 * `drainOnce`, while the worker wraps its tick in `traced(...)` at the call site. Forcing a
 * trace-wrap here would either double-span the relay or strip the span its test asserts on.
 */
export function createDrainLoop(intervalMs: number, tick: () => Promise<unknown>): () => void {
  const timer = setInterval(() => {
    void tick().catch(() => undefined)
  }, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}

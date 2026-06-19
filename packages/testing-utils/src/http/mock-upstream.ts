import {
  getGlobalDispatcher,
  MockAgent,
  fetch as realUndiciFetch,
  setGlobalDispatcher,
} from 'undici'

/**
 * The fetch to INJECT into a client under test. It is undici's own `fetch`, which honors the MockAgent
 * installed by `mockUpstream()` — Node's *built-in* global `fetch` does NOT (its bundled undici uses a
 * different global-dispatcher instance), so a client must receive this `fetch` (dependency injection,
 * the project's house style) to be interceptable. Typed as the global `typeof fetch` so it drops into
 * any `fetchImpl: typeof fetch` seam. Production clients keep their default global fetch.
 */
export const undiciFetch: typeof fetch = realUndiciFetch as unknown as typeof fetch

/**
 * Outbound-HTTP faking for unit tests via undici `MockAgent`: declarative status/body/delay/
 * connection-error replies, real request matching, no global monkey-patching. Pair with `undiciFetch`
 * (inject it into the client). Replaces the three ad-hoc styles the audit found (global fetch stub,
 * copy-pasted neverResolvingFetch, black-hole URL). See UNIT-L1-PLAN.md §3.3.
 *
 *   const up = mockUpstream()
 *   up.pool('http://payment').intercept({ path: '/charges', method: 'POST' }).reply(200, { id: 'ch_1' })
 *   const client = createPaymentClient('http://payment', undiciFetch)
 *   // ... assert ...
 *   await up.restore()   // in afterEach
 */
export interface MockUpstream {
  /** The underlying MockAgent, for advanced cases (assertNoPendingInterceptors, persist, etc.). */
  agent: MockAgent
  /** Interceptor pool for an origin; chain `.intercept({ path, method }).reply(...)`. */
  pool(origin: string): ReturnType<MockAgent['get']>
  /** Restore the previous global dispatcher and close the mock. Call in afterEach. */
  restore(): Promise<void>
}

export function mockUpstream(): MockUpstream {
  const previous = getGlobalDispatcher()
  const agent = new MockAgent()
  // Any un-mocked outbound call throws instead of reaching the network — hermetic by default.
  agent.disableNetConnect()
  setGlobalDispatcher(agent)
  return {
    agent,
    pool: (origin) => agent.get(origin),
    async restore() {
      setGlobalDispatcher(previous)
      await agent.close()
    },
  }
}

/**
 * A `fetch` double that never resolves and only rejects when its `AbortSignal` fires (with the
 * signal's reason). Models a hung upstream so a client's own `AbortSignal.timeout` is what unblocks
 * the call. Shared replacement for the copy-pasted per-service `neverResolvingFetch`.
 */
export const hangingFetch: typeof fetch = (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal
    // An already-aborted signal never fires 'abort' again — reject now or the promise hangs forever.
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    signal?.addEventListener('abort', () => reject(signal.reason))
  })

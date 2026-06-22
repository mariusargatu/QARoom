/**
 * Fetch doubles for the production `createHttpWebhookSender` unit tests. The real outbound network
 * is infra; the sender takes an injectable `fetchImpl`, so these in-memory doubles exercise every
 * branch (2xx success / non-2xx http_error / aborted timeout / transport network_error) and the
 * request shaping — with no socket bound. They live in a non-test `-fake.ts` sibling so the test
 * bodies stay free of any control flow (the harness convention).
 */

export interface FetchCall {
  url: string
  init: RequestInit
}

/** A fetch double that records each call and resolves to a `Response` with the given status. */
export function recordingFetch(status: number): { calls: FetchCall[]; fetchImpl: typeof fetch } {
  const calls: FetchCall[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    return new Response('', { status })
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

/**
 * A fetch double that rejects with an `AbortError` — exactly what the sender's `AbortController`
 * timeout surfaces, so the sender must map it to a `timeout` result.
 */
export const abortingFetch = (async () =>
  Promise.reject(
    new DOMException('The operation was aborted', 'AbortError'),
  )) as unknown as typeof fetch

/**
 * A fetch double that rejects with a generic transport error (DNS failure, connection reset),
 * which the sender must map to a `network_error` result.
 */
export const networkErrorFetch = (async () =>
  Promise.reject(new Error('ECONNRESET'))) as unknown as typeof fetch

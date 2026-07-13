import { type CircuitBreaker, CircuitOpenError } from './circuit-breaker'
import { type ClientResponse, type UpstreamCallOptions, upstreamCall } from './upstream-call'

/**
 * Map an upstream status to a breaker signal: an "upstream is sick" failure (`false`), a healthy
 * success (`true`), or no signal (`undefined`). A 5xx other than 502 means the upstream itself is
 * erroring → failure. A 2xx/3xx → success. A 4xx (client error) and a 502 (the upstream is UP,
 * cleanly reporting its own dependency is down — e.g. donations' payment provider) are NOT
 * upstream-is-sick signals — they leave the breaker untouched so a flaky downstream dependency or
 * validation errors don't fast-fail unrelated reads that never touch that dependency.
 */
function breakerSignal(status: number): boolean | undefined {
  if (status >= 500 && status !== 502) return false
  if (status < 400) return true
  return undefined
}

/**
 * One `upstreamCall` guarded by an optional `CircuitBreaker` (experiment 06): when the breaker is
 * open the call fails fast with `CircuitOpenError` (→ a typed 502 in `forward()`), so the gateway
 * stops hammering a sick upstream and stops paying the per-call timeout. A transport failure
 * (throw) always records a breaker failure; a delivered response feeds `breakerSignal`. With
 * `breaker` undefined this is a plain bounded upstream call — exactly the experiment-06
 * deliberate-bug demo.
 */
export async function breakerGuardedCall(
  breaker: CircuitBreaker | undefined,
  baseUrl: string,
  opts: UpstreamCallOptions,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ClientResponse> {
  if (breaker && !breaker.allow()) throw new CircuitOpenError()
  try {
    const res = await upstreamCall(baseUrl, opts, timeoutMs, fetchImpl)
    const signal = breakerSignal(res.status)
    if (signal !== undefined) breaker?.record(signal)
    return res
  } catch (err) {
    breaker?.record(false)
    throw err
  }
}

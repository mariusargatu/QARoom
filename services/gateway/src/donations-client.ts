import { type CircuitBreaker, CircuitOpenError } from './circuit-breaker'
import { type ClientResponse, upstreamCall, upstreamTimeoutMs } from './upstream-call'

/**
 * The gateway's client for donations-service. Like the content client it is a thin seam
 * (the Pact consumer for the gateway→donations contract) — but it is additionally guarded
 * by a `CircuitBreaker`. Under sustained provider failure (experiment 06) the breaker opens
 * and calls fail fast with `CircuitOpenError` (→ a typed 502), so the gateway stops hammering
 * a sick provider and stops paying the per-call timeout. Omit the breaker to disable the
 * mitigation — that is exactly the experiment-06 deliberate-bug demo.
 */
export interface DonationsClient {
  listDonations(communityId: string): Promise<ClientResponse>
  getDonation(communityId: string, donationId: string): Promise<ClientResponse>
  createDonation(
    communityId: string,
    body: unknown,
    idempotencyKey: string,
  ): Promise<ClientResponse>
}

export interface DonationsClientOptions {
  timeoutMs?: number
  /** Guards every call. Omit (or pass undefined) to run with the breaker disabled. */
  breaker?: CircuitBreaker
}

/**
 * Map an upstream status to a breaker signal: a "donations is sick" failure (`false`), a healthy
 * success (`true`), or no signal (`undefined`). A 5xx other than 502 means donations itself is
 * erroring → failure. A 2xx/3xx → success. A 4xx (client error) and a 502 (donations is UP, cleanly
 * reporting its payment dependency is down) are NOT donations-is-sick signals — they leave the
 * breaker untouched so a flaky payment provider or validation errors don't fast-fail unrelated
 * reads (list/get) that never touch the provider.
 */
function breakerSignal(status: number): boolean | undefined {
  if (status >= 500 && status !== 502) return false
  if (status < 400) return true
  return undefined
}

export function createDonationsClient(
  baseUrl: string,
  options: DonationsClientOptions = {},
): DonationsClient {
  const timeoutMs = options.timeoutMs ?? upstreamTimeoutMs()
  const { breaker } = options

  async function call(opts: Parameters<typeof upstreamCall>[1]): Promise<ClientResponse> {
    if (breaker && !breaker.allow()) throw new CircuitOpenError()
    try {
      const res = await upstreamCall(baseUrl, opts, timeoutMs)
      const signal = breakerSignal(res.status)
      if (signal !== undefined) breaker?.record(signal)
      return res
    } catch (err) {
      breaker?.record(false)
      throw err
    }
  }

  return {
    listDonations: (communityId) =>
      call({ method: 'GET', path: `/api/communities/${communityId}/donations` }),
    getDonation: (communityId, donationId) =>
      call({ method: 'GET', path: `/api/communities/${communityId}/donations/${donationId}` }),
    createDonation: (communityId, body, idempotencyKey) =>
      call({
        method: 'POST',
        path: `/api/communities/${communityId}/donations`,
        body,
        idempotencyKey,
      }),
  }
}

import { breakerGuardedCall } from './breaker-guarded-call'
import type { CircuitBreaker } from './circuit-breaker'
import {
  type ClientResponse,
  type UpstreamCallOptions,
  type UpstreamClientOptions,
  upstreamTimeoutMs,
} from './upstream-call'

/**
 * The gateway's client for donations-service. Like the content client it is a thin seam
 * (the Pact consumer for the gateway→donations contract) — but it is additionally guarded
 * by a `CircuitBreaker` via `breakerGuardedCall` (see `breaker-guarded-call.ts` for the
 * open/record semantics). Omit the breaker to disable the mitigation — that is exactly the
 * experiment-06 deliberate-bug demo.
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

export interface DonationsClientOptions extends UpstreamClientOptions {
  /** Guards every call. Omit (or pass undefined) to run with the breaker disabled. */
  breaker?: CircuitBreaker
}

export function createDonationsClient(
  baseUrl: string,
  options: DonationsClientOptions = {},
): DonationsClient {
  const timeoutMs = options.timeoutMs ?? upstreamTimeoutMs()
  const { breaker } = options
  const fetchImpl = options.fetchImpl ?? fetch
  const call = (opts: UpstreamCallOptions) =>
    breakerGuardedCall(breaker, baseUrl, opts, timeoutMs, fetchImpl)

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

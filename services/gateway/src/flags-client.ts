import { boundCaller, type ClientResponse, type UpstreamClientOptions } from './upstream-call'

/**
 * The gateway's client for flags-service. A thin, bounded-timeout seam (the Pact consumer for
 * the gateway→flags contract). No circuit breaker here: flag resolution is a cheap read and
 * rollout advance is a low-rate write, so the partition mitigation (experiment 07) is just the
 * upstream timeout → typed 502.
 */
export interface FlagsClient {
  resolveFlag(communityId: string, flagKey: string): Promise<ClientResponse>
  listFlags(communityId: string): Promise<ClientResponse>
  advanceRollout(
    communityId: string,
    flagKey: string,
    body: unknown,
    idempotencyKey: string,
  ): Promise<ClientResponse>
}

export function createFlagsClient(
  baseUrl: string,
  options: UpstreamClientOptions = {},
): FlagsClient {
  const call = boundCaller(baseUrl, options)
  return {
    resolveFlag: (communityId, flagKey) =>
      call({ method: 'GET', path: `/api/communities/${communityId}/flags/${flagKey}` }),
    listFlags: (communityId) =>
      call({ method: 'GET', path: `/api/communities/${communityId}/flags` }),
    advanceRollout: (communityId, flagKey, body, idempotencyKey) =>
      call({
        method: 'POST',
        path: `/api/communities/${communityId}/flags/${flagKey}/rollout`,
        body,
        idempotencyKey,
      }),
  }
}

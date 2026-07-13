import {
  boundCaller,
  type ClientResponse,
  type UpstreamClientOptions,
} from '../resilience/upstream-call'

/**
 * The gateway's client for the moderator-agent (the one Python service, ADR-0018). Read-only: the
 * gateway proxies the decision reads so the web frontend can render a moderation dashboard. The
 * agent PROPOSES decisions and never enforces, so there is no mutating surface here. Unlike the
 * other upstreams, moderator-agent is not a Pact provider (Python) — these reads are integration-
 * tested at the gateway instead. A thin bounded-timeout seam; a partition → typed 502.
 */
export interface ModeratorClient {
  listDecisions(communityId: string): Promise<ClientResponse>
  getDecision(communityId: string, decisionId: string): Promise<ClientResponse>
}

export function createModeratorClient(
  baseUrl: string,
  options: UpstreamClientOptions = {},
): ModeratorClient {
  const call = boundCaller(baseUrl, options)
  return {
    listDecisions: (communityId) =>
      call({ method: 'GET', path: `/api/communities/${communityId}/moderation-decisions` }),
    getDecision: (communityId, decisionId) =>
      call({
        method: 'GET',
        path: `/api/communities/${communityId}/moderation-decisions/${decisionId}`,
      }),
  }
}

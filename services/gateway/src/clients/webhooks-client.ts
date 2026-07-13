import {
  boundCaller,
  type ClientResponse,
  type UpstreamClientOptions,
} from '../resilience/upstream-call'

/**
 * The gateway's client for webhooks-service (Milestone 11). A thin seam — the Pact consumer for
 * the gateway→webhooks contract — bounded by the shared upstream timeout (see
 * `upstream-call.ts`). No circuit breaker: production never wired one (the option was dead
 * code), so the mitigation for an unreachable webhooks-service is the bounded timeout → typed
 * 502, as for flags and identity.
 */
export interface WebhooksClient {
  createWebhook(communityId: string, body: unknown, idempotencyKey: string): Promise<ClientResponse>
  listWebhooks(communityId: string): Promise<ClientResponse>
  getWebhook(communityId: string, subscriptionId: string): Promise<ClientResponse>
  deleteWebhook(
    communityId: string,
    subscriptionId: string,
    idempotencyKey: string,
  ): Promise<ClientResponse>
  pauseWebhook(
    communityId: string,
    subscriptionId: string,
    idempotencyKey: string,
  ): Promise<ClientResponse>
  resumeWebhook(
    communityId: string,
    subscriptionId: string,
    idempotencyKey: string,
  ): Promise<ClientResponse>
  listWebhookDeliveries(communityId: string, subscriptionId: string): Promise<ClientResponse>
}

export function createWebhooksClient(
  baseUrl: string,
  options: UpstreamClientOptions = {},
): WebhooksClient {
  const call = boundCaller(baseUrl, options)

  const base = (communityId: string) => `/api/communities/${communityId}/webhook-subscriptions`
  return {
    createWebhook: (communityId, body, idempotencyKey) =>
      call({ method: 'POST', path: base(communityId), body, idempotencyKey }),
    listWebhooks: (communityId) => call({ method: 'GET', path: base(communityId) }),
    getWebhook: (communityId, subscriptionId) =>
      call({ method: 'GET', path: `${base(communityId)}/${subscriptionId}` }),
    deleteWebhook: (communityId, subscriptionId, idempotencyKey) =>
      call({ method: 'DELETE', path: `${base(communityId)}/${subscriptionId}`, idempotencyKey }),
    // No request body: pause/resume are pure state toggles — the provider reads only path params.
    // Sending `{}` was pointless and tripped a pact-core empty-object serialization bug on verify.
    pauseWebhook: (communityId, subscriptionId, idempotencyKey) =>
      call({
        method: 'POST',
        path: `${base(communityId)}/${subscriptionId}/pause`,
        idempotencyKey,
      }),
    resumeWebhook: (communityId, subscriptionId, idempotencyKey) =>
      call({
        method: 'POST',
        path: `${base(communityId)}/${subscriptionId}/resume`,
        idempotencyKey,
      }),
    listWebhookDeliveries: (communityId, subscriptionId) =>
      call({ method: 'GET', path: `${base(communityId)}/${subscriptionId}/deliveries` }),
  }
}

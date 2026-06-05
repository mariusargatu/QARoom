import { type CircuitBreaker, CircuitOpenError } from './circuit-breaker'
import { type ClientResponse, upstreamCall, upstreamTimeoutMs } from './upstream-call'

/**
 * The gateway's client for webhooks-service (Milestone 11). A thin seam — the Pact consumer for
 * the gateway→webhooks contract — guarded by a `CircuitBreaker` like the donations client: under
 * sustained webhooks-service failure the breaker opens and calls fail fast with `CircuitOpenError`
 * (→ a typed 502). Omit the breaker to disable the mitigation.
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

export interface WebhooksClientOptions {
  timeoutMs?: number
  breaker?: CircuitBreaker
}

/** A 5xx (other than 502) means webhooks-service itself is erroring → breaker failure; 2xx/3xx → success. */
function breakerSignal(status: number): boolean | undefined {
  if (status >= 500 && status !== 502) return false
  if (status < 400) return true
  return undefined
}

export function createWebhooksClient(
  baseUrl: string,
  options: WebhooksClientOptions = {},
): WebhooksClient {
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

  const base = (communityId: string) => `/api/communities/${communityId}/webhook-subscriptions`
  return {
    createWebhook: (communityId, body, idempotencyKey) =>
      call({ method: 'POST', path: base(communityId), body, idempotencyKey }),
    listWebhooks: (communityId) => call({ method: 'GET', path: base(communityId) }),
    getWebhook: (communityId, subscriptionId) =>
      call({ method: 'GET', path: `${base(communityId)}/${subscriptionId}` }),
    deleteWebhook: (communityId, subscriptionId, idempotencyKey) =>
      call({ method: 'DELETE', path: `${base(communityId)}/${subscriptionId}`, idempotencyKey }),
    pauseWebhook: (communityId, subscriptionId, idempotencyKey) =>
      call({
        method: 'POST',
        path: `${base(communityId)}/${subscriptionId}/pause`,
        body: {},
        idempotencyKey,
      }),
    resumeWebhook: (communityId, subscriptionId, idempotencyKey) =>
      call({
        method: 'POST',
        path: `${base(communityId)}/${subscriptionId}/resume`,
        body: {},
        idempotencyKey,
      }),
    listWebhookDeliveries: (communityId, subscriptionId) =>
      call({ method: 'GET', path: `${base(communityId)}/${subscriptionId}/deliveries` }),
  }
}

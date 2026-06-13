/**
 * Thin client for the external payment provider (Milestone 5). In the cluster the base URL
 * points at the Microcks mock of `payment-provider.openapi.yaml`; in tests an injected stub
 * stands in. The client is the single injectable seam, so donations-service code never reaches
 * for a global `fetch` and the provider can be swapped or virtualized without touching the
 * repository.
 */

export interface ChargeRequest {
  amount_cents: number
  currency: string
  /** Forwarded so a client retry is idempotent at the provider too. */
  idempotency_key: string
}

export interface PaymentAuthorization {
  provider_ref: string
  /** `captured` = money taken; `declined` = the provider refused (a recorded business outcome). */
  status: 'captured' | 'declined'
}

export interface PaymentClient {
  charge(req: ChargeRequest): Promise<PaymentAuthorization>
}

/**
 * The production client: POST /charges, throwing on any non-2xx (a provider/transport fault).
 * Every call is bounded by `AbortSignal.timeout` (default 5s, the same value as the gateway's
 * `upstream-call.ts` and webhooks' `sender.ts`): a hung provider becomes a fast throw → 502
 * `dependency_failure` instead of a socket held open until the OS TCP timeout.
 */
export function createPaymentClient(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5_000,
): PaymentClient {
  const base = baseUrl.replace(/\/$/, '')
  return {
    async charge(req) {
      const res = await fetchImpl(`${base}/charges`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': req.idempotency_key },
        body: JSON.stringify({ amount_cents: req.amount_cents, currency: req.currency }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`payment provider returned ${res.status}: ${body.slice(0, 200)}`)
      }
      const json = (await res.json()) as { id: string; status: string }
      return { provider_ref: json.id, status: json.status === 'captured' ? 'captured' : 'declined' }
    },
  }
}

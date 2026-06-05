/**
 * The outbound HTTP seam (Milestone 11, ADR-0019). The delivery worker POSTs to subscriber URLs
 * ONLY through this interface — the single injectable boundary, exactly like donations-service's
 * `PaymentClient`. Production wires real `fetch` with an `AbortController` timeout; tests wire a
 * programmable double that returns scripted `success / http_error / timeout / network_error`,
 * which is what makes the at-least-once and retry-contract properties deterministic and
 * broker-free. The sender NEVER throws — every fault maps to a `SendResult`.
 */

export type SendResult =
  | { kind: 'success'; status: number }
  | { kind: 'http_error'; status: number }
  | { kind: 'timeout' }
  | { kind: 'network_error' }

export interface WebhookSendRequest {
  url: string
  body: string
  headers: Record<string, string>
}

export interface WebhookSender {
  send(req: WebhookSendRequest): Promise<SendResult>
}

/** Whether a send outcome counts as a successful delivery (2xx). */
export function isDelivered(result: SendResult): boolean {
  return result.kind === 'success'
}

/**
 * The production sender: POST the signed body with a timeout. A 2xx is `success`; any other
 * status is `http_error`; an abort is `timeout`; anything else (DNS, connection reset) is
 * `network_error`. Returns — never throws — so the worker's state machine stays total.
 */
export function createHttpWebhookSender(
  timeoutMs = 5_000,
  fetchImpl: typeof fetch = fetch,
): WebhookSender {
  return {
    async send(req) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetchImpl(req.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...req.headers },
          body: req.body,
          signal: controller.signal,
        })
        return res.ok
          ? { kind: 'success', status: res.status }
          : { kind: 'http_error', status: res.status }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return { kind: 'timeout' }
        return { kind: 'network_error' }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

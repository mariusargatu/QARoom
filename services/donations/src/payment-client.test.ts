import { describe, expect, it } from 'vitest'
import { createPaymentClient } from './payment-client'

/**
 * A never-resolving fetch double that honors its `AbortSignal` the way undici does: it settles
 * only when the signal fires, rejecting with the signal's reason. With a real fetch a hung
 * provider holds the socket for minutes; this double proves the client's own
 * `AbortSignal.timeout` is what unblocks the call (prior art: gateway `ticket-client.test.ts`).
 */
const neverResolvingFetch: typeof fetch = (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal
    signal?.addEventListener('abort', () => reject(signal.reason))
  })

describe('createPaymentClient timeout', () => {
  it('aborts a hung charge call with a TimeoutError once the bounded timeout elapses', async () => {
    const client = createPaymentClient('http://payment-provider', neverResolvingFetch, 0)

    await expect(
      client.charge({ amount_cents: 500, currency: 'USD', idempotency_key: 'idem-timeout-1' }),
    ).rejects.toMatchObject({ name: 'TimeoutError' })
  })
})

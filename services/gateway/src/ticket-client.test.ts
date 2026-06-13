import { describe, expect, it } from 'vitest'
import { createTicketClient } from './ticket-client'

/**
 * A never-resolving fetch double that honors its `AbortSignal` the way undici does: it settles
 * only when the signal fires, rejecting with the signal's reason. With a real fetch a partition
 * leaves the socket open for minutes; this double proves the client's own `AbortSignal.timeout`
 * is what unblocks the call (prior art: `moderator-client.test.ts` timeout seam).
 */
const neverResolvingFetch: typeof fetch = (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal
    signal?.addEventListener('abort', () => reject(signal.reason))
  })

describe('createTicketClient timeout', () => {
  it('aborts a hung redeem call with a TimeoutError once the bounded timeout elapses', async () => {
    const client = createTicketClient('http://identity', neverResolvingFetch, 0)

    await expect(client.redeem('some-ticket')).rejects.toMatchObject({ name: 'TimeoutError' })
  })
})

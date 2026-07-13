import { EXAMPLE_USER_ID } from '@qaroom/contracts'
import {
  hangingFetch,
  type MockUpstream,
  mockUpstream,
  undiciFetch,
} from '@qaroom/testing-utils/http'
import { afterEach, describe, expect, it } from 'vitest'
import { createTicketClient } from './ticket-client'

/**
 * The gateway redeems a WS ticket against identity before upgrading a connection (ADR-0013). The
 * status contract is security-relevant: a 401 (unknown/expired/used ticket) must surface as `null`
 * (→ the gateway refuses the upgrade), while any other non-2xx is a provider fault that throws.
 * Outbound calls go through undici's MockAgent via the injected `undiciFetch`.
 */
const BASE = 'http://identity'
const REDEEM_PATH = '/ws/tickets/redeem'

describe('createTicketClient.redeem against identity', () => {
  let up: MockUpstream

  afterEach(async () => {
    await up.restore()
  })

  it('POSTs the ticket to /ws/tickets/redeem and parses the principal from a 200', async () => {
    const captured: { method?: string; path?: string; body: string | null } = { body: null }
    up = mockUpstream()
    up.pool(BASE)
      .intercept({ path: REDEEM_PATH, method: 'POST' })
      .reply((opts) => {
        captured.method = opts.method
        captured.path = opts.path
        captured.body = (opts.body as string | null) ?? null
        return { statusCode: 200, data: { user_id: EXAMPLE_USER_ID, memberships: [] } }
      })

    const principal = await createTicketClient(BASE, undiciFetch).redeem('tkt_live')

    expect(principal).toEqual({ user_id: EXAMPLE_USER_ID, memberships: [] })
    expect(captured.method).toBe('POST')
    expect(captured.path).toBe(REDEEM_PATH)
    expect(JSON.parse(String(captured.body))).toEqual({ ticket: 'tkt_live' })
  })

  it('returns null on a 401 (the ticket is unknown, expired, or already used)', async () => {
    up = mockUpstream()
    up.pool(BASE)
      .intercept({ path: REDEEM_PATH, method: 'POST' })
      .reply(401, { type: 'about:blank' })

    expect(await createTicketClient(BASE, undiciFetch).redeem('tkt_stale')).toBeNull()
  })

  it('throws on a 500 — any non-401 failure is a provider fault, not a refusal', async () => {
    up = mockUpstream()
    up.pool(BASE).intercept({ path: REDEEM_PATH, method: 'POST' }).reply(500, 'boom')

    await expect(createTicketClient(BASE, undiciFetch).redeem('tkt_x')).rejects.toThrow(
      /identity ticket redeem returned 500/,
    )
  })

  it('throws on a 403 rather than silently admitting the connection', async () => {
    up = mockUpstream()
    up.pool(BASE).intercept({ path: REDEEM_PATH, method: 'POST' }).reply(403, {})

    await expect(createTicketClient(BASE, undiciFetch).redeem('tkt_y')).rejects.toThrow(
      /identity ticket redeem returned 403/,
    )
  })

  it('trims a trailing slash from the base URL so the redeem path is not doubled', async () => {
    up = mockUpstream()
    up.pool(BASE)
      .intercept({ path: REDEEM_PATH, method: 'POST' })
      .reply(200, { user_id: EXAMPLE_USER_ID, memberships: [] })

    const principal = await createTicketClient(`${BASE}/`, undiciFetch).redeem('tkt_z')

    expect(principal).not.toBeNull()
  })
})

// hangingFetch (shared): settles only when its AbortSignal fires, so the client's own
// AbortSignal.timeout is what unblocks a hung redeem (prior art: moderator-client.test.ts).
describe('createTicketClient timeout', () => {
  it('aborts a hung redeem call with a TimeoutError once the bounded timeout elapses', async () => {
    const client = createTicketClient('http://identity', hangingFetch, 0)

    await expect(client.redeem('some-ticket')).rejects.toMatchObject({ name: 'TimeoutError' })
  })
})

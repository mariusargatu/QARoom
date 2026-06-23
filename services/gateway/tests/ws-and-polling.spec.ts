import {
  CommunityId,
  type EventPage,
  FlagKey,
  type FlagState,
  type RedeemTicketResponse,
  UserId,
} from '@qaroom/contracts'
import { expectWsEventMatchesPolling } from '@qaroom/testing-utils/matchers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import type { FrameInput } from '../src/event-stream'
import { constantContent, SAMPLE, setupGatewayTest, ticketStub } from './harness'

const PRINCIPAL: RedeemTicketResponse = {
  user_id: UserId.parse(SAMPLE.user),
  memberships: [{ community_id: CommunityId.parse(SAMPLE.community), role: 'member' }],
}

const flagFrame = (state: FlagState, enabled: boolean): FrameInput => ({
  type: 'flag.state.changed',
  community_id: CommunityId.parse(SAMPLE.community),
  occurred_at: '2026-06-04T00:00:00.000Z',
  flag_key: FlagKey.parse('donations'),
  state,
  enabled,
})

type Gateway = ReturnType<typeof setupGatewayTest>
let open: Gateway | undefined

afterEach(async () => {
  await open?.app.close()
  open = undefined
})

async function listen(ctx: Gateway): Promise<string> {
  open = ctx
  await ctx.app.listen({ port: 0, host: '127.0.0.1' })
  const addr = ctx.app.server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  return `ws://127.0.0.1:${port}`
}

function openSocket(
  url: string,
  protocols: string[],
  onMessage: (frame: unknown) => void = () => {},
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, protocols)
    // Attach the message listener BEFORE 'open' so a backlog frame replayed on connect is never missed.
    socket.on('message', (data) => onMessage(JSON.parse(data.toString())))
    socket.on('open', () => resolve(socket))
    socket.on('unexpected-response', (_req, res) => {
      reject(
        Object.assign(new Error(`handshake rejected: ${res.statusCode}`), {
          statusCode: res.statusCode,
        }),
      )
    })
    socket.on('error', (err) => reject(err))
  })
}

/**
 * Open a WS handshake we EXPECT to be rejected before the upgrade, and surface both the HTTP
 * status and the RFC 7807 problem body the gateway returned. If the socket upgrades instead
 * (the membership check was bypassed), reject loudly so the negative test fails clearly.
 */
function openSocketExpectingRejection(
  url: string,
  protocols: string[],
): Promise<{ statusCode?: number; body: { type?: string; failure_domain?: string } }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, protocols)
    socket.on('open', () => {
      socket.close()
      reject(new Error('handshake unexpectedly succeeded — the membership 403 check was bypassed'))
    })
    socket.on('unexpected-response', (_req, res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () =>
        resolve({ statusCode: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }),
      )
    })
    socket.on('error', () => {})
  })
}

describe('WebSocket membership authorization (ws-not-a-member)', () => {
  it('rejects the handshake (403 ws-not-a-member) when the principal is not a member of the requested community', async () => {
    // PRINCIPAL is a member of SAMPLE.community only — request a DIFFERENT community.
    const ctx = setupGatewayTest(constantContent({ status: 200, body: {}, contentType: null }), {
      tickets: ticketStub({ tkt_good: PRINCIPAL }),
    })
    const url = await listen(ctx)
    const rejection = await openSocketExpectingRejection(
      `${url}/ws?community=${SAMPLE.communityOther}`,
      ['ticket.tkt_good'],
    )
    expect(rejection.statusCode).toBe(403)
    expect(rejection.body.type).toContain('ws-not-a-member')
    expect(rejection.body.failure_domain).toBe('authorization')
  }, 15000)

  it('accepts the handshake and streams for a community the principal IS a member of (positive control)', async () => {
    const ctx = setupGatewayTest(constantContent({ status: 200, body: {}, contentType: null }), {
      tickets: ticketStub({ tkt_good: PRINCIPAL }),
    })
    const url = await listen(ctx)
    const received: unknown[] = []
    const socket = await openSocket(
      `${url}/ws?community=${SAMPLE.community}`,
      ['ticket.tkt_good'],
      (m) => received.push(m),
    )
    ctx.eventStream.publish(flagFrame('Enabling', false))
    await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 5000 })
    socket.close()
    expect(received).toHaveLength(1)
  }, 15000)

  // KNOWN GAP, tracked in the ledger (not just in an events-routes.ts comment): the polling fallback
  // `GET /api/communities/:cid/events` enforces NO membership — a non-member reads any community's
  // stream. The WS path's `ws-not-a-member` 403 has no polling-path equivalent. The REST plane is
  // unauthenticated by design until Milestone 13 (no REST edge-auth primitive yet — the one-use WS
  // ticket does not fit repeated polling), so this is a pending TODO, not a failing assertion. When
  // M13 lands, turn this into the polling analogue of the ws-not-a-member 403 test above.
  it.todo(
    'enforces community membership on the polling path (403) once Milestone 13 REST edge-auth lands',
  )
})

describe('WebSocket ticket handshake', () => {
  it('rejects the handshake (401) when no ticket subprotocol is presented', async () => {
    const ctx = setupGatewayTest(constantContent({ status: 200, body: {}, contentType: null }))
    const url = await listen(ctx)
    const err = await openSocket(`${url}/ws?community=${SAMPLE.community}`, []).catch((e) => e)
    expect((err as { statusCode?: number }).statusCode).toBe(401)
  }, 15000)

  it('rejects the handshake (401) for an unknown ticket', async () => {
    const ctx = setupGatewayTest(constantContent({ status: 200, body: {}, contentType: null }), {
      tickets: ticketStub({}),
    })
    const url = await listen(ctx)
    const err = await openSocket(`${url}/ws?community=${SAMPLE.community}`, [
      'ticket.tkt_nope',
    ]).catch((e) => e)
    expect((err as { statusCode?: number }).statusCode).toBe(401)
  }, 15000)

  it('accepts a valid ticket and streams live envelopes', async () => {
    const ctx = setupGatewayTest(constantContent({ status: 200, body: {}, contentType: null }), {
      tickets: ticketStub({ tkt_good: PRINCIPAL }),
    })
    const url = await listen(ctx)
    const received: unknown[] = []
    const socket = await openSocket(
      `${url}/ws?community=${SAMPLE.community}`,
      ['ticket.tkt_good'],
      (m) => received.push(m),
    )

    ctx.eventStream.publish(flagFrame('Enabling', false))
    ctx.eventStream.publish(flagFrame('Canary', false))
    await vi.waitFor(() => expect(received).toHaveLength(2), { timeout: 5000 })
    socket.close()

    expect(received).toHaveLength(2)
    expect((received[0] as { state: string }).state).toBe('Enabling')
  }, 15000)
})

describe('WebSocket / polling parity (Commitment 11)', () => {
  it('delivers the same envelopes over WS and over the polling endpoint', async () => {
    const ctx = setupGatewayTest(constantContent({ status: 200, body: {}, contentType: null }), {
      tickets: ticketStub({ tkt_good: PRINCIPAL }),
    })
    // Pre-publish a backlog, then connect (the handler replays backlog), then publish live.
    ctx.eventStream.publish(flagFrame('Enabling', false))
    const url = await listen(ctx)
    const wsReceived: unknown[] = []
    const socket = await openSocket(
      `${url}/ws?community=${SAMPLE.community}`,
      ['ticket.tkt_good'],
      (m) => wsReceived.push(m),
    )

    ctx.eventStream.publish(flagFrame('Canary', false))
    ctx.eventStream.publish(flagFrame('Enabled', true))
    await vi.waitFor(() => expect(wsReceived).toHaveLength(3), { timeout: 5000 })
    socket.close()

    const poll = await ctx.request.get(`/api/communities/${SAMPLE.community}/events`)
    const polled = (poll.json as EventPage).events
    // The two transports must agree exactly for the window.
    expectWsEventMatchesPolling(wsReceived, polled)
  }, 15000)
})

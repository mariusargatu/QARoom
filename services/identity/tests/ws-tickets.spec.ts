import { nextIdempotencyKey } from '@qaroom/testing-utils/harness'
import { expectRFC7807 } from '@qaroom/testing-utils/matchers'
import { describe, expect, it } from 'vitest'
import { setupIdentityTest } from './harness'

const nextKey = () => nextIdempotencyKey('ws-ticket')

/** Create a user and issue an access token; returns the Bearer JWT. */
async function authenticate(ctx: Awaited<ReturnType<typeof setupIdentityTest>>): Promise<string> {
  const user = await ctx.request.post(
    '/api/users',
    { handle: 'ada', display_name: 'Ada Lovelace' },
    { 'idempotency-key': nextKey() },
  )
  const userId = (user.json as { id: string }).id
  const session = await ctx.request.post(
    '/api/sessions',
    { user_id: userId },
    { 'idempotency-key': nextKey() },
  )
  return (session.json as { access_token: string }).access_token
}

describe('WebSocket ticket issuance and redemption', () => {
  it('mints a 30-second ticket for an authenticated principal', async () => {
    const ctx = await setupIdentityTest()
    const token = await authenticate(ctx)
    const res = await ctx.request.post('/ws/tickets', {}, { authorization: `Bearer ${token}` })
    await ctx.close()
    expect(res.status).toBe(201)
    expect(res.json).toMatchObject({ expires_in_seconds: 30 })
    expect((res.json as { ticket: string }).ticket).toMatch(/^tkt_/)
  })

  it('redeems a fresh ticket exactly once and returns the principal', async () => {
    const ctx = await setupIdentityTest()
    const token = await authenticate(ctx)
    const minted = await ctx.request.post('/ws/tickets', {}, { authorization: `Bearer ${token}` })
    const ticket = (minted.json as { ticket: string }).ticket
    const redeemed = await ctx.request.post('/ws/tickets/redeem', { ticket })
    await ctx.close()
    expect(redeemed.status).toBe(200)
    expect((redeemed.json as { user_id: string }).user_id).toMatch(/^user_/)
  })

  it('rejects a replayed ticket (one-use)', async () => {
    const ctx = await setupIdentityTest()
    const token = await authenticate(ctx)
    const minted = await ctx.request.post('/ws/tickets', {}, { authorization: `Bearer ${token}` })
    const ticket = (minted.json as { ticket: string }).ticket
    await ctx.request.post('/ws/tickets/redeem', { ticket })
    const replay = await ctx.request.post('/ws/tickets/redeem', { ticket })
    await ctx.close()
    expectRFC7807(replay.json, { status: 401, failureDomain: 'authentication' })
  })

  it('rejects an expired ticket after the 30-second window', async () => {
    const ctx = await setupIdentityTest()
    const token = await authenticate(ctx)
    const minted = await ctx.request.post('/ws/tickets', {}, { authorization: `Bearer ${token}` })
    const ticket = (minted.json as { ticket: string }).ticket
    ctx.clock.advance(31_000)
    const redeemed = await ctx.request.post('/ws/tickets/redeem', { ticket })
    await ctx.close()
    expectRFC7807(redeemed.json, { status: 401, failureDomain: 'authentication' })
  })

  it('rejects minting without a Bearer token', async () => {
    const ctx = await setupIdentityTest()
    const res = await ctx.request.post('/ws/tickets', {})
    await ctx.close()
    expectRFC7807(res.json, { status: 401, failureDomain: 'authentication' })
  })

  it('rejects minting with a tampered JWT', async () => {
    const ctx = await setupIdentityTest()
    const token = await authenticate(ctx)
    const tampered = `${token.slice(0, -4)}AAAA`
    const res = await ctx.request.post('/ws/tickets', {}, { authorization: `Bearer ${tampered}` })
    await ctx.close()
    expectRFC7807(res.json, { status: 401, failureDomain: 'authentication' })
  })
})

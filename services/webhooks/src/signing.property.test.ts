import { createHmac } from 'node:crypto'
import { test } from '@fast-check/vitest'
import { WEBHOOK_SIGNATURE_HEADER, WEBHOOK_TIMESTAMP_HEADER } from '@qaroom/contracts'
import { signWebhook, verifyWebhook } from '@qaroom/contracts/webhook-hmac'
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import {
  drainToQuiescence,
  enqueueDelivery,
  makeWorker,
  okSender,
  seedSubscription,
  setupWebhooksTest,
} from '../tests/harness'

/**
 * HMAC signature properties (contract level). A correctly-signed delivery verifies; any tamper
 * fails; the timestamp bound into the signature defeats replay outside the freshness window.
 */
describe('webhook signature', () => {
  test.prop([fc.string(), fc.string({ minLength: 1 }), fc.string()])(
    'a correctly-signed payload verifies; tampering with the body breaks it',
    (secret, body, ts) => {
      const sig = signWebhook(secret, ts, body)
      expect(verifyWebhook(secret, ts, body, sig)).toBe(true)
      expect(verifyWebhook(secret, ts, `${body}x`, sig)).toBe(false)
    },
  )

  test.prop([fc.string({ minLength: 1 }), fc.string()])(
    'a captured signature does not verify for a different timestamp (replay defense is bound in)',
    (secret, body) => {
      const sig = signWebhook(secret, '2026-06-05T12:00:00.000Z', body)
      expect(verifyWebhook(secret, '2026-06-05T13:00:00.000Z', body, sig)).toBe(false)
    },
  )

  it('rejects an otherwise-valid signature outside the freshness window', () => {
    const secret = 'whsec_x'
    const ts = '2026-06-05T12:00:00.000Z'
    const body = '{"a":1}'
    const sig = signWebhook(secret, ts, body)
    const stale = new Date('2026-06-05T12:30:00.000Z') // 30 min later
    expect(verifyWebhook(secret, ts, body, sig, { now: stale, toleranceSeconds: 300 })).toBe(false)
  })
})

// Deliberate-bug demo: CHAOS_WEBHOOK_SIGN_BODY_ONLY signs the body without binding the timestamp,
// so the emitted signature equals the body-only HMAC — a captured (body, signature) pair replays
// with any timestamp. The correct worker binds the timestamp, so its signature differs.
describe('CHAOS_WEBHOOK_SIGN_BODY_ONLY deliberate-bug demo', () => {
  afterEach(() => {
    delete process.env.CHAOS_WEBHOOK_SIGN_BODY_ONLY
  })

  async function emittedSignature(): Promise<{
    secret: string
    ts: string
    body: string
    sig: string
  }> {
    const ctx = await setupWebhooksTest()
    const sub = await seedSubscription(ctx)
    await enqueueDelivery(ctx, { subscriptionId: sub.id })
    const sender = okSender()
    await drainToQuiescence(ctx, makeWorker(ctx, sender))
    const call = sender.calls[0]
    await ctx.close()
    expect(call).toBeDefined()
    return {
      secret: sub.secret,
      ts: call?.headers[WEBHOOK_TIMESTAMP_HEADER] ?? '',
      body: call?.body ?? '',
      sig: call?.headers[WEBHOOK_SIGNATURE_HEADER] ?? '',
    }
  }

  it('the correct worker binds the timestamp into the signature', async () => {
    const { secret, ts, body, sig } = await emittedSignature()
    const bodyOnly = `v1=${createHmac('sha256', secret).update(body).digest('hex')}`
    expect(sig).toBe(signWebhook(secret, ts, body))
    expect(sig).not.toBe(bodyOnly)
  })

  it('the bugged worker signs body-only, so the signature is replayable across timestamps', async () => {
    process.env.CHAOS_WEBHOOK_SIGN_BODY_ONLY = '1'
    const { secret, body, sig } = await emittedSignature()
    const bodyOnly = `v1=${createHmac('sha256', secret).update(body).digest('hex')}`
    expect(sig).toBe(bodyOnly) // independent of the timestamp → replayable
  })
})

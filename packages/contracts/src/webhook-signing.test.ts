import type { Randomness } from '@qaroom/determinism'
import { describe, expect, it } from 'vitest'
import { signWebhook, verifyWebhook } from './webhook-hmac'
import { generateWebhookSecret, webhookSigningInput } from './webhook-signing'

const SECRET = 'whsec_test'
const TS = '2026-06-05T12:00:00.000Z'
const BODY = '{"event":"post.created"}'

describe('signWebhook / verifyWebhook', () => {
  it('round-trips: a correctly-signed delivery verifies', () => {
    const sig = signWebhook(SECRET, TS, BODY)
    expect(verifyWebhook(SECRET, TS, BODY, sig)).toBe(true)
  })

  it('is deterministic for a fixed (secret, timestamp, body)', () => {
    expect(signWebhook(SECRET, TS, BODY)).toBe(signWebhook(SECRET, TS, BODY))
  })

  it('rejects a tampered body', () => {
    const sig = signWebhook(SECRET, TS, BODY)
    expect(verifyWebhook(SECRET, TS, `${BODY} `, sig)).toBe(false)
  })

  it('rejects a tampered timestamp (replay defense is baked into the signature)', () => {
    const sig = signWebhook(SECRET, TS, BODY)
    expect(verifyWebhook(SECRET, '2026-06-05T13:00:00.000Z', BODY, sig)).toBe(false)
  })

  it('rejects a signature minted under a different secret', () => {
    const sig = signWebhook('whsec_other', TS, BODY)
    expect(verifyWebhook(SECRET, TS, BODY, sig)).toBe(false)
  })

  it('binds the timestamp into the signed bytes', () => {
    expect(webhookSigningInput(TS, BODY)).toBe(`${TS}.${BODY}`)
  })
})

describe('verifyWebhook freshness window', () => {
  it('accepts a signature inside the tolerance window', () => {
    const sig = signWebhook(SECRET, TS, BODY)
    const now = new Date('2026-06-05T12:00:30.000Z') // 30s later
    expect(verifyWebhook(SECRET, TS, BODY, sig, { now, toleranceSeconds: 300 })).toBe(true)
  })

  it('rejects an otherwise-valid signature outside the tolerance window (replay)', () => {
    const sig = signWebhook(SECRET, TS, BODY)
    const now = new Date('2026-06-05T13:00:00.000Z') // 1h later
    expect(verifyWebhook(SECRET, TS, BODY, sig, { now, toleranceSeconds: 300 })).toBe(false)
  })
})

describe('generateWebhookSecret', () => {
  it('mints a prefixed 32-byte hex secret from injected randomness', () => {
    const r: Randomness = { next: () => 0, int: () => 0 }
    expect(generateWebhookSecret(r)).toBe(`whsec_${'00'.repeat(32)}`)
  })

  it('is deterministic given the same randomness sequence', () => {
    let counter = 0
    const make = (): Randomness => {
      counter = 0
      return { next: () => 0, int: () => counter++ % 256 }
    }
    expect(generateWebhookSecret(make())).toBe(generateWebhookSecret(make()))
  })
})

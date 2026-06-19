import { describe, expect, it } from 'vitest'
import { type PactMessage, verifyEnvelopeAgainstMessage } from './verify-message-pact'

/**
 * Negative-control unit test for the hand-rolled message-pact verifier. Without this, the provider
 * spec only ever asserts `mismatches.toEqual([])` on a GOOD envelope — a verifier that always
 * returned `[]` would pass vacuously. Here we feed known-BAD envelopes and assert the verifier
 * actually reports them, plus a known-GOOD envelope that must verify clean.
 */
const MESSAGE: PactMessage = {
  description: 'a post created event',
  contents: {
    event_id: 'evt_00000000000000000000000000',
    title: 'a title',
  },
  metadata: {
    'event-name': 'post.created',
    'Nats-Msg-Id': 'evt_00000000000000000000000000',
    contentType: 'application/json',
  },
  matchingRules: {
    body: {
      '$.event_id': { matchers: [{ match: 'regex', regex: '^evt_[0-9A-HJKMNP-TV-Z]{26}$' }] },
      '$.title': { matchers: [{ match: 'type' }] },
    },
    metadata: {
      'Nats-Msg-Id': { matchers: [{ match: 'regex', regex: '^evt_[0-9A-HJKMNP-TV-Z]{26}$' }] },
    },
  },
}

const goodEnvelope = {
  payload: { event_id: 'evt_00000000000000000000000001', title: 'hello' },
  headers: { 'event-name': 'post.created', 'Nats-Msg-Id': 'evt_00000000000000000000000001' },
}

describe('verifyEnvelopeAgainstMessage — positive control', () => {
  it('returns no mismatches for an envelope that satisfies every rule', () => {
    expect(verifyEnvelopeAgainstMessage(goodEnvelope, MESSAGE)).toEqual([])
  })
})

describe('verifyEnvelopeAgainstMessage — negative controls (must report each)', () => {
  it('reports a regex-violating body field', () => {
    const env = { ...goodEnvelope, payload: { ...goodEnvelope.payload, event_id: 'not-an-evt-id' } }
    expect(verifyEnvelopeAgainstMessage(env, MESSAGE).length).toBeGreaterThan(0)
  })

  it('reports a missing (undefined) regex-matched field instead of passing it', () => {
    const env = { ...goodEnvelope, payload: { title: 'hello' } }
    expect(verifyEnvelopeAgainstMessage(env, MESSAGE).length).toBeGreaterThan(0)
  })

  it('reports a null regex-matched field instead of stringifying it to "null"', () => {
    const env = { ...goodEnvelope, payload: { ...goodEnvelope.payload, event_id: null } }
    expect(verifyEnvelopeAgainstMessage(env, MESSAGE).length).toBeGreaterThan(0)
  })

  it('reports a wrong exact-match metadata value (event-name)', () => {
    const env = { ...goodEnvelope, headers: { ...goodEnvelope.headers, 'event-name': 'vote.cast' } }
    expect(verifyEnvelopeAgainstMessage(env, MESSAGE).length).toBeGreaterThan(0)
  })

  it('reports a type-matched field whose runtime type differs from the example', () => {
    const env = { ...goodEnvelope, payload: { ...goodEnvelope.payload, title: 42 } }
    expect(verifyEnvelopeAgainstMessage(env, MESSAGE).length).toBeGreaterThan(0)
  })

  it('reports a rule with an empty matchers array (field would go unverified)', () => {
    const message: PactMessage = {
      ...MESSAGE,
      matchingRules: { body: { '$.event_id': { matchers: [] } }, metadata: {} },
    }
    expect(verifyEnvelopeAgainstMessage(goodEnvelope, message).length).toBeGreaterThan(0)
  })

  it('reports a regex matcher with no pattern', () => {
    const message: PactMessage = {
      ...MESSAGE,
      matchingRules: { body: { '$.event_id': { matchers: [{ match: 'regex' }] } }, metadata: {} },
    }
    expect(verifyEnvelopeAgainstMessage(goodEnvelope, message).length).toBeGreaterThan(0)
  })

  it('reports an unsupported matcher kind instead of treating it as no constraint', () => {
    const message: PactMessage = {
      ...MESSAGE,
      matchingRules: { body: { '$.event_id': { matchers: [{ match: 'date' }] } }, metadata: {} },
    }
    expect(verifyEnvelopeAgainstMessage(goodEnvelope, message).length).toBeGreaterThan(0)
  })
})

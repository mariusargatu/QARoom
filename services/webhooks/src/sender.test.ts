import { describe, expect, it } from 'vitest'
import { isDelivered, type SendResult } from './sender'

/**
 * The delivery oracle (Milestone 11, ADR-0019). `isDelivered` is the single classifier that decides
 * whether a `SendResult` counts as a terminal success or must keep retrying / dead-letter. A bug
 * here is silent: a non-2xx outcome (a 410 Gone or a 429 Too Many Requests) wrongly classed as
 * Delivered would drop the event with no retry and no dead-letter. This enumerates the kinds so that
 * exactly one bucket — a 2xx `success` — is Delivered, and every error kind is not.
 */
describe('isDelivered', () => {
  it.each([200, 201, 202, 204, 206, 299])('a 2xx success (%i) is Delivered', (status) => {
    const result: SendResult = { kind: 'success', status }
    expect(isDelivered(result)).toBe(true)
  })

  // The crux: error statuses that look "final" to a naive classifier must NOT be Delivered. A 410
  // means the resource is gone (retry/dead-letter, do not drop); a 429 means slow down (retry).
  it.each([
    400, 404, 410, 422, 429, 500, 502, 503,
  ])('an http_error (%i) is NOT Delivered (it must retry or dead-letter)', (status) => {
    const result: SendResult = { kind: 'http_error', status }
    expect(isDelivered(result)).toBe(false)
  })

  it('a timeout is NOT Delivered', () => {
    expect(isDelivered({ kind: 'timeout' })).toBe(false)
  })

  it('a network_error is NOT Delivered', () => {
    expect(isDelivered({ kind: 'network_error' })).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { chargeError, isMembershipBypassed } from './_review-demo'

describe('review-demo helper', () => {
  it('builds a charge error payload', () => {
    expect(chargeError('upstream 500')).toEqual({ error: 'upstream 500', code: 502 })
  })

  it('detects the bypass header', () => {
    expect(isMembershipBypassed('let-me-in')).toBe(true)
  })
})

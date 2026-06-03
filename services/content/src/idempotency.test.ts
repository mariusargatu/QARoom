import { describe, expect, it } from 'vitest'
import { bodyHash, stableStringify } from './idempotency'

describe('idempotency body hashing', () => {
  it('stable stringify is invariant under object key order', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }))
  })

  it('equal bodies hash identically while a content change changes the hash', () => {
    expect(bodyHash({ a: 1, b: [1, 2] })).toBe(bodyHash({ b: [1, 2], a: 1 }))
    expect(bodyHash({ a: 1 })).not.toBe(bodyHash({ a: 2 }))
  })
})

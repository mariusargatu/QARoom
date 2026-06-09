import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime, formatMoney, shortId } from './format'

describe('shortId', () => {
  // `user_` puts the separator at index 4, so the keep-as-is boundary is length <= 13.
  it('returns the id unchanged when its length is below the separator-plus-nine boundary', () => {
    expect(shortId('user_1234567')).toBe('user_1234567') // length 12, below 13
  })

  it('returns the id unchanged when its length is exactly at the separator-plus-nine boundary', () => {
    expect(shortId('user_12345678')).toBe('user_12345678') // length 13, == sep + 9
  })

  it('compacts the id to prefix and last four when its length is above the boundary', () => {
    expect(shortId('user_123456789')).toBe('user_…6789') // length 14, above 13
  })

  it('returns the id unchanged when it has no separator', () => {
    expect(shortId('0123456789abcdef')).toBe('0123456789abcdef')
  })
})

describe('formatMoney', () => {
  it('formats cents as a localized currency amount for a valid currency code', () => {
    expect(formatMoney(12345, 'USD')).toBe('$123.45')
  })

  // A malformed code (`USDX` is not a valid ISO-4217 length) makes Intl.NumberFormat throw
  // RangeError; the recent fix catches it and falls back to a plain amount instead of crashing.
  it('falls back to a plain amount with the raw code for an invalid currency, without throwing', () => {
    expect(() => formatMoney(12345, 'USDX')).not.toThrow()
    expect(formatMoney(12345, 'USDX')).toBe('123.45 USDX')
  })
})

describe('formatDate', () => {
  it('slices the date portion out of an ISO-8601 timestamp', () => {
    expect(formatDate('2026-05-28T12:00:00.000Z')).toBe('2026-05-28')
  })
})

describe('formatDateTime', () => {
  it('slices the date and hours-minutes out of an ISO-8601 timestamp', () => {
    expect(formatDateTime('2026-05-28T12:00:00.000Z')).toBe('2026-05-28 12:00')
  })
})

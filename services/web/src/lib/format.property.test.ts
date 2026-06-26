import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime, formatMoney, shortId } from './format'

// Property tests for the pure display formatters (ADR-0005: fast-check is the repo test-data +
// property standard). `format.ts` slices ISO strings rather than touching the clock, so each
// formatter is a pure substring/round-trip function with strong, falsifiable invariants. The
// example-based `format.test.ts` pins concrete cases; these pin the laws across the whole input
// space (extraction round-trip, prefix, idempotence, length bounds, robustness, determinism).

// Build a canonical ISO-8601 timestamp from numeric components so the date/time formatters can be
// checked as exact substring extractors. `padStart` has no branching, so the test bodies stay free
// of conditional logic (qaroom/no-conditional-in-test).
const pad = (value: number, width: number): string => String(value).padStart(width, '0')

const isoArb = fc
  .record({
    y: fc.integer({ min: 0, max: 9999 }),
    mo: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 28 }),
    h: fc.integer({ min: 0, max: 23 }),
    mi: fc.integer({ min: 0, max: 59 }),
    s: fc.integer({ min: 0, max: 59 }),
    ms: fc.integer({ min: 0, max: 999 }),
  })
  .map(({ y, mo, d, h, mi, s, ms }) => ({
    iso: `${pad(y, 4)}-${pad(mo, 2)}-${pad(d, 2)}T${pad(h, 2)}:${pad(mi, 2)}:${pad(s, 2)}.${pad(ms, 3)}Z`,
    date: `${pad(y, 4)}-${pad(mo, 2)}-${pad(d, 2)}`,
    hhmm: `${pad(h, 2)}:${pad(mi, 2)}`,
  }))

describe('formatDate / formatDateTime invariants', () => {
  it('extracts exactly the YYYY-MM-DD date out of any canonical ISO timestamp', () => {
    fc.assert(
      fc.property(isoArb, ({ iso, date }) => {
        expect(formatDate(iso)).toBe(date)
      }),
    )
  })

  it('extracts the date joined to HH:MM out of any canonical ISO timestamp', () => {
    fc.assert(
      fc.property(isoArb, ({ iso, date, hhmm }) => {
        expect(formatDateTime(iso)).toBe(`${date} ${hhmm}`)
      }),
    )
  })

  it('shares its first ten characters with the date-only formatter for a canonical timestamp', () => {
    fc.assert(
      fc.property(isoArb, ({ iso }) => {
        expect(formatDateTime(iso).slice(0, 10)).toBe(formatDate(iso))
      }),
    )
  })

  it('never returns more than the ten date characters for any input string', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(formatDate(s).length).toBeLessThanOrEqual(10)
      }),
    )
  })

  it('always returns a prefix of the original string', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(s.startsWith(formatDate(s))).toBe(true)
      }),
    )
  })

  it('is idempotent: re-formatting an already-formatted date changes nothing', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(formatDate(formatDate(s))).toBe(formatDate(s))
      }),
    )
  })
})

describe('shortId invariants', () => {
  it('is idempotent: compacting an already-compacted id changes nothing', () => {
    fc.assert(
      fc.property(fc.string(), (id) => {
        expect(shortId(shortId(id))).toBe(shortId(id))
      }),
    )
  })

  it('never produces a string longer than the original id', () => {
    fc.assert(
      fc.property(fc.string(), (id) => {
        expect(shortId(id).length).toBeLessThanOrEqual(id.length)
      }),
    )
  })

  it('leaves an id with no separator completely untouched', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !s.includes('_')),
        (id) => {
          expect(shortId(id)).toBe(id)
        },
      ),
    )
  })

  it('keeps the prefix and the trailing four characters when compacting a long prefixed id', () => {
    const lower = 'abcdefghijklmnopqrstuvwxyz'.split('')
    const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'.split('')
    const prefixArb = fc
      .array(fc.constantFrom(...lower), { minLength: 1, maxLength: 6 })
      .map((c) => c.join(''))
    // body length >= 9 guarantees id.length > indexOf('_') + 9, the compaction boundary.
    const bodyArb = fc
      .array(fc.constantFrom(...crockford), { minLength: 9, maxLength: 30 })
      .map((c) => c.join(''))
    fc.assert(
      fc.property(prefixArb, bodyArb, (prefix, body) => {
        const id = `${prefix}_${body}`
        const short = shortId(id)
        expect(short).toBe(`${prefix}_…${id.slice(-4)}`)
        expect(short.startsWith(`${prefix}_`)).toBe(true)
        expect(short.endsWith(id.slice(-4))).toBe(true)
      }),
    )
  })
})

describe('formatMoney invariants', () => {
  it('never throws for any integer amount and any currency string', () => {
    fc.assert(
      fc.property(fc.integer(), fc.string(), (cents, currency) => {
        expect(() => formatMoney(cents, currency)).not.toThrow()
      }),
    )
  })

  it('is deterministic: formatting the same amount and currency twice is identical', () => {
    fc.assert(
      fc.property(fc.integer(), fc.string(), (cents, currency) => {
        expect(formatMoney(cents, currency)).toBe(formatMoney(cents, currency))
      }),
    )
  })

  it('falls back to a plain decimal amount and the raw code for a non-letter currency', () => {
    // A purely numeric string can never be a 3-letter ISO-4217 code, so Intl.NumberFormat throws
    // and the formatter takes its catch-fallback branch.
    const invalidCurrency = fc.nat({ max: 9_999_999 }).map((n) => String(n))
    fc.assert(
      fc.property(fc.integer(), invalidCurrency, (cents, currency) => {
        expect(formatMoney(cents, currency)).toBe(`${(cents / 100).toFixed(2)} ${currency}`)
      }),
    )
  })
})

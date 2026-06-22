import { afterEach, describe, expect, it } from 'vitest'
import { pgPoolMax } from './db'
import { intFromEnv } from './env'

/**
 * `intFromEnv` is the one guard against the `Number("")===0` env trap (an empty Helm-templated
 * env silently collapsing a timeout/pool/port to 0). Every branch is pinned here, plus the
 * `pgPoolMax` consumer that layers an explicit-override-then-env-then-default precedence on top.
 */
describe('intFromEnv', () => {
  afterEach(() => {
    delete process.env.QAROOM_TEST_INT
  })

  it('returns the fallback when the variable is unset', () => {
    expect(intFromEnv('QAROOM_TEST_INT', 42)).toBe(42)
  })

  it('returns the fallback for the empty string (the Number("")===0 trap)', () => {
    process.env.QAROOM_TEST_INT = ''
    expect(intFromEnv('QAROOM_TEST_INT', 42)).toBe(42)
  })

  it('returns the fallback for a blank/whitespace string', () => {
    process.env.QAROOM_TEST_INT = '   '
    expect(intFromEnv('QAROOM_TEST_INT', 42)).toBe(42)
  })

  it('returns the fallback for a non-numeric string', () => {
    process.env.QAROOM_TEST_INT = 'abc'
    expect(intFromEnv('QAROOM_TEST_INT', 42)).toBe(42)
  })

  it('returns the fallback for zero (not a positive integer)', () => {
    process.env.QAROOM_TEST_INT = '0'
    expect(intFromEnv('QAROOM_TEST_INT', 42)).toBe(42)
  })

  it('returns the fallback for a negative number', () => {
    process.env.QAROOM_TEST_INT = '-5'
    expect(intFromEnv('QAROOM_TEST_INT', 42)).toBe(42)
  })

  it('returns the fallback for a non-finite value', () => {
    process.env.QAROOM_TEST_INT = 'Infinity'
    expect(intFromEnv('QAROOM_TEST_INT', 42)).toBe(42)
  })

  it('parses a positive integer', () => {
    process.env.QAROOM_TEST_INT = '25'
    expect(intFromEnv('QAROOM_TEST_INT', 42)).toBe(25)
  })

  it('floors a positive fractional value', () => {
    process.env.QAROOM_TEST_INT = '7.9'
    expect(intFromEnv('QAROOM_TEST_INT', 42)).toBe(7)
  })
})

describe('pgPoolMax', () => {
  afterEach(() => {
    delete process.env.PG_POOL_MAX
  })

  it('defaults to 10 when neither an override nor PG_POOL_MAX is set', () => {
    expect(pgPoolMax()).toBe(10)
  })

  it('prefers an explicit override over the env and the default', () => {
    process.env.PG_POOL_MAX = '3'
    expect(pgPoolMax({ max: 50 })).toBe(50)
  })

  it('reads PG_POOL_MAX when no override is given', () => {
    process.env.PG_POOL_MAX = '20'
    expect(pgPoolMax()).toBe(20)
  })

  it('falls back to the default when PG_POOL_MAX is blank (never a max:0 pool)', () => {
    process.env.PG_POOL_MAX = ''
    expect(pgPoolMax()).toBe(10)
  })
})

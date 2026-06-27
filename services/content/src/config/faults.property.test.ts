import { test } from '@fast-check/vitest'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { NO_FAULTS, resolveFaults } from './faults'

/**
 * Unit-layer PBT (the sweet spot: a pure function, no per-iteration resource, so the global numRuns
 * default applies cheaply). Pins the env->FaultConfig parse contract across the whole input space, not
 * a handful of examples — guards a future refactor from silently flipping toggle semantics, which only
 * env-armed cluster/matrix runs would otherwise catch.
 */
const BOOLEAN_TOGGLES = [
  'CONTENT_BUG_FEED_REVERSED',
  'CONTENT_BUG_TENANT_LEAK',
  'CHAOS_SYNC_PUBLISH',
  'CONTENT_BUG_VOTE_OUT_OF_RANGE',
  'CONTENT_BUG_VOTE_OUT_OF_SET',
  'CONTENT_BUG_DISABLE_RLS',
] as const
const FIELD_OF = {
  CONTENT_BUG_FEED_REVERSED: 'feedReversed',
  CONTENT_BUG_TENANT_LEAK: 'tenantLeak',
  CHAOS_SYNC_PUBLISH: 'syncPublish',
  CONTENT_BUG_VOTE_OUT_OF_RANGE: 'voteOutOfRange',
  CONTENT_BUG_VOTE_OUT_OF_SET: 'voteOutOfSet',
  CONTENT_BUG_DISABLE_RLS: 'disableRls',
} as const

describe('resolveFaults (property)', () => {
  test.prop([fc.constantFrom(...BOOLEAN_TOGGLES), fc.string()])(
    'a boolean toggle is armed iff its env value is exactly the string "1"',
    (envVar, value) => {
      const faults = resolveFaults({ [envVar]: value })
      expect(faults[FIELD_OF[envVar]]).toBe(value === '1')
    },
  )

  test.prop([fc.integer({ min: 0, max: 600_000 })])(
    'a numeric CONTENT_BUG_VOTE_SLOW_MS parses to that number',
    (ms) => {
      expect(resolveFaults({ CONTENT_BUG_VOTE_SLOW_MS: String(ms) }).voteSlowMs).toBe(ms)
    },
  )

  test.prop([fc.string().filter((s) => s !== '' && !Number.isFinite(Number(s)))])(
    'a non-numeric CONTENT_BUG_VOTE_SLOW_MS throws loudly rather than silently disabling the fault',
    (garbage) => {
      expect(() => resolveFaults({ CONTENT_BUG_VOTE_SLOW_MS: garbage })).toThrow(/must be a number/)
    },
  )

  test.prop([fc.dictionary(fc.constantFrom(...BOOLEAN_TOGGLES), fc.string())])(
    'any boolean-only env yields a well-typed FaultConfig with voteSlowMs 0',
    (env) => {
      const faults = resolveFaults(env)
      expect(typeof faults.feedReversed).toBe('boolean')
      expect(typeof faults.tenantLeak).toBe('boolean')
      expect(typeof faults.syncPublish).toBe('boolean')
      expect(typeof faults.voteOutOfRange).toBe('boolean')
      expect(typeof faults.voteOutOfSet).toBe('boolean')
      expect(typeof faults.disableRls).toBe('boolean')
      expect(faults.voteSlowMs).toBe(0)
    },
  )

  it('NO_FAULTS is all-off and frozen so the shared default cannot be mutated', () => {
    expect(NO_FAULTS).toEqual({
      feedReversed: false,
      tenantLeak: false,
      voteSlowMs: 0,
      syncPublish: false,
      voteOutOfRange: false,
      voteOutOfSet: false,
      disableRls: false,
    })
    expect(Object.isFrozen(NO_FAULTS)).toBe(true)
  })
})

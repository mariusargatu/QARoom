import { describe, expect, it } from 'vitest'
import { captureScenario, runTwiceAndDiff, structuralFingerprint } from './run-scenario'

/**
 * The determinism scaffolding: capture (never let act() throw to the caller), a structural
 * fingerprint that ignores key order, and the twice-run diff that PROVES a scenario is
 * reproducible under the seeded trio (the basis for folding a `scenario` runner with confidence).
 */
describe('captureScenario', () => {
  it('tags a successful act with its value and a null error', async () => {
    expect(await captureScenario(async () => ({ ok: true }))).toEqual({
      value: { ok: true },
      error: null,
    })
  })

  it('tags a throwing act with a normalized error and a null value', async () => {
    const outcome = await captureScenario(async () => {
      throw new TypeError('boom')
    })

    expect(outcome.value).toBeNull()
    expect(outcome.error).toEqual({ name: 'TypeError', message: 'boom' })
  })

  it('normalizes a null rejection without itself throwing (any thrown value is honored)', async () => {
    const outcome = await captureScenario(async () => {
      throw null
    })

    expect(outcome.value).toBeNull()
    expect(outcome.error).toEqual({ name: 'Error', message: 'null' })
  })
})

describe('structuralFingerprint', () => {
  it('is identical for two objects that differ only in key order', () => {
    expect(structuralFingerprint({ a: 1, b: [{ y: 2, x: 1 }] })).toBe(
      structuralFingerprint({ b: [{ x: 1, y: 2 }], a: 1 }),
    )
  })

  it('differs when a value differs', () => {
    expect(structuralFingerprint({ a: 1 })).not.toBe(structuralFingerprint({ a: 2 }))
  })

  it('distinguishes two different Date instants instead of collapsing both to {}', () => {
    // The determinism oracle exists to catch timestamp drift — a Date must not normalize to `{}`.
    const earlier = structuralFingerprint({ at: new Date('2026-01-01T00:00:00.000Z') })
    const later = structuralFingerprint({ at: new Date('2026-06-19T00:00:00.000Z') })

    expect(earlier).not.toBe(later)
    expect(earlier).toBe(structuralFingerprint({ at: new Date('2026-01-01T00:00:00.000Z') }))
  })

  it('normalizes a bigint to a tagged string instead of crashing the JSON.stringify', () => {
    // Surfaced by the harness mutation lane (ADR-0031): without the dedicated bigint branch
    // JSON.stringify THROWS, so the determinism oracle would crash on any bigint-bearing outcome
    // rather than compare it. Tag-and-keep, distinct from the same numeric value.
    expect(structuralFingerprint({ v: 10n })).toBe('{"v":"10n"}')
    expect(structuralFingerprint({ v: 10n })).not.toBe(structuralFingerprint({ v: 10 }))
  })

  it('keeps an array distinct from an object carrying the same numeric keys', () => {
    // Surfaced by the harness mutation lane (ADR-0031): the Array.isArray branch is load-bearing —
    // an array and `{0:..,1:..}` must NOT collapse to one fingerprint, or the oracle would call two
    // structurally-different outcomes identical and let a real determinism leak through.
    expect(structuralFingerprint([1, 2])).not.toBe(structuralFingerprint({ 0: 1, 1: 2 }))
  })
})

describe('runTwiceAndDiff', () => {
  it('reports identical when a seeded scenario yields the same outcome both runs', async () => {
    // A counter that resets per build models a fresh seeded world: both runs see the same value.
    const build = async () => {
      const state = { n: 0 }
      return {
        act: async () => {
          state.n += 1
          return { n: state.n }
        },
        close: async () => {},
      }
    }

    const check = await runTwiceAndDiff(build)
    expect(check.identical).toBe(true)
    expect(check.first).toEqual({ value: { n: 1 }, error: null })
  })

  it('reports non-identical when the outcome depends on state leaking across runs', async () => {
    // A counter shared ACROSS builds models a determinism leak: run 2 differs from run 1.
    const shared = { n: 0 }
    const build = async () => ({
      act: async () => {
        shared.n += 1
        return { n: shared.n }
      },
      close: async () => {},
    })

    const check = await runTwiceAndDiff(build)
    expect(check.identical).toBe(false)
  })
})

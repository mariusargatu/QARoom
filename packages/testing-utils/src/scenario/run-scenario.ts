/**
 * Determinism scaffolding for fault scenarios. A scenario is "build a seeded world, act against it
 * under injected faults, observe the typed outcome". Two observations matter:
 *  - EXPECTED faults must surface as typed RFC 7807 Problem Details, never an uncaught throw — so
 *    `captureScenario` normalizes act() into a tagged value-or-error a catalog can assert on.
 *  - The whole point of the seeded determinism trio (Clock/IdGenerator/Randomness) is that the SAME
 *    scenario yields the SAME observable twice. `runTwiceAndDiff` builds the world from scratch
 *    twice (same seed) and structurally diffs the outcomes — snapshot-replay's determinism proof,
 *    applied to fault injection.
 */
import { withResource } from '../harness/with-resource'

export interface ScenarioOutcome<R> {
  /** The act's return value, or null when it threw. */
  value: R | null
  /** The normalized error (name + message), or null when it succeeded. */
  error: { name: string; message: string } | null
}

/** Run `act`, capturing either its value or a normalized error — never throwing to the caller. */
export async function captureScenario<R>(act: () => Promise<R>): Promise<ScenarioOutcome<R>> {
  try {
    return { value: await act(), error: null }
  } catch (err) {
    // `err` is ANY thrown value — including null/undefined/a primitive (`throw null`,
    // `Promise.reject()`). Coalesce to {} BEFORE reading fields so this helper keeps its
    // "never throws to the caller" contract; `String(err)` still renders the original null/undefined.
    const e = (err ?? {}) as { name?: unknown; message?: unknown }
    return {
      value: null,
      error: {
        name: typeof e.name === 'string' ? e.name : 'Error',
        message: typeof e.message === 'string' ? e.message : String(err),
      },
    }
  }
}

/**
 * A stable structural fingerprint of any JSON-ish value: keys sorted at every depth so two
 * structurally-equal outcomes serialize identically regardless of property insertion order. Used to
 * compare two runs of the same scenario; NOT a hash (kept readable for diff output on mismatch).
 */
export function structuralFingerprint(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    // A Date is exactly the nondeterminism this oracle exists to catch — normalize to its ISO instant
    // (Object.keys(Date) is empty, so without this two different instants would both collapse to {}
    // and falsely compare identical). A bigint would also crash the JSON.stringify below.
    if (v instanceof Date) return v.toISOString()
    if (typeof v === 'bigint') return `${v}n`
    if (Array.isArray(v)) return v.map(normalize)
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, normalize((v as Record<string, unknown>)[k])]),
      )
    }
    return v
  }
  return JSON.stringify(normalize(value))
}

export interface DeterminismCheck<R> {
  first: ScenarioOutcome<R>
  second: ScenarioOutcome<R>
  /** True when both runs produced a structurally-identical outcome. */
  identical: boolean
}

/**
 * Build + run a scenario twice from scratch (a fresh seeded world each pass) and structurally diff
 * the two outcomes. `build` returns the `act` plus a `close` for the run's resources (e.g. the
 * pglite db); both runs are torn down. `identical` proves the scenario is deterministic under the
 * seeded trio — the substrate for folding a `scenario` runner into summary.json with confidence.
 */
export async function runTwiceAndDiff<R>(
  build: () => Promise<{ act: () => Promise<R>; close: () => Promise<void> }>,
): Promise<DeterminismCheck<R>> {
  // withResource owns the acquire/try-finally/close so a failing scenario can't leak its pglite world.
  const run = (): Promise<ScenarioOutcome<R>> =>
    withResource(build, ({ act }) => captureScenario(act))

  const first = await run()
  const second = await run()
  return {
    first,
    second,
    identical: structuralFingerprint(first) === structuralFingerprint(second),
  }
}

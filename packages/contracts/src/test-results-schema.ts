import { z } from 'zod'

/**
 * FROZEN schema for `test-results/summary.json` (Commitment 14, do-not-touch list).
 *
 * The ENVELOPE is frozen: `schema_version`, `generated_at`, `totals`, and the
 * shape of `runners[]`. The PER-RUNNER payload is extensible — `output` and
 * `seeds` are `Record<string, unknown>`, so new runners add fields without a
 * breaking change. Bumping `schema_version` requires a superseding decision.
 */
export const SCHEMA_VERSION = 1 as const

export const RunnerResult = z
  .object({
    name: z.string(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative().default(0),
    duration_ms: z.number().nonnegative().default(0),
    /** Extensible per-runner payload. */
    output: z.record(z.string(), z.unknown()).default({}),
    /** Property-test seeds and fuzzing seeds, keyed by runner-defined names. */
    seeds: z.record(z.string(), z.unknown()).default({}),
  })
  .meta({ id: 'RunnerResult' })
export type RunnerResult = z.infer<typeof RunnerResult>

export const TestResultsSummary = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    generated_at: z.iso.datetime(),
    commit: z.string().optional(),
    totals: z.object({
      passed: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative(),
    }),
    runners: z.array(RunnerResult),
  })
  .meta({
    id: 'TestResultsSummary',
    description: 'Aggregated machine-readable test results (frozen envelope).',
  })
export type TestResultsSummary = z.infer<typeof TestResultsSummary>

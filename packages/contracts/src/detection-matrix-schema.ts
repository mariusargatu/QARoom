import { z } from 'zod'

/**
 * Schema for `test-results/detection-matrix.json` — the artifact of the detection-matrix
 * experiment (bug-toggle × technique battery: which technique catches which deliberate bug,
 * measured, not asserted). A separate file from the frozen `test-results-schema.ts` on purpose:
 * the matrix is its own experiment artifact, not a runner result, and the summary envelope's
 * do-not-touch guarantee stays intact.
 *
 * Verdict semantics (mechanical, no message-content curation): technique group G CATCHES toggle
 * T iff ≥1 test file classified into G fails under T, passed in the baseline (same commit/seed),
 * and still passes on a toggle-off re-run (else `unstable`). Cells are idempotent on
 * (toggle, technique, tier) — re-running a tier replaces its cells, mirroring fold-runner.
 */
export const MatrixTier = z.enum(['in-proc', 'cluster', 'llm'])
export type MatrixTier = z.infer<typeof MatrixTier>

export const CellStatus = z.enum([
  /** ≥1 baseline-green test file in this technique group went red under the toggle. */
  'caught',
  /** The battery ran and every file in this group stayed green — empirical blindness. */
  'missed',
  /** Not run, with a structural justification (no code path) — never a silent hole. */
  'na',
  /** Not run because the cell costs real money/cluster-time — declared, not hidden. */
  'skipped-cost',
  /** Failed under the toggle but ALSO failed the toggle-off re-run — environment flake. */
  'unstable',
])
export type CellStatus = z.infer<typeof CellStatus>

export const MatrixCell = z.object({
  toggle: z.string(),
  technique: z.string(),
  tier: MatrixTier,
  status: CellStatus,
  commit: z.string(),
  recorded_at: z.string(),
  duration_ms: z.number(),
  evidence: z.object({
    /** Test files newly failing under the toggle (empty for missed/na/skipped-cost). */
    newly_failing: z.array(z.string()),
    /** Required when status is `na`: the structural no-code-path argument. */
    justification: z.string().optional(),
    /** Actual spend for llm-tier cells — recorded per cell, never estimated post hoc. */
    cost_usd: z.number().optional(),
  }),
})
export type MatrixCell = z.infer<typeof MatrixCell>

export const MatrixBaseline = z.object({
  commit: z.string(),
  recorded_at: z.string(),
  fastcheck_seed: z.number().optional(),
  /** Files red WITHOUT any toggle (same commit/seed) — excluded from every verdict. */
  standing_reds: z.array(z.string()),
})
export type MatrixBaseline = z.infer<typeof MatrixBaseline>

export const DetectionMatrixArtifact = z.object({
  schema_version: z.literal(1),
  generated_at: z.string(),
  baseline: MatrixBaseline.nullable(),
  cells: z.array(MatrixCell),
})
export type DetectionMatrixArtifact = z.infer<typeof DetectionMatrixArtifact>

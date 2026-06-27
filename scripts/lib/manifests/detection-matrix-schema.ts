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

// ── The detection-toggle schema (relocated from detection-matrix.ts to keep that codeowned manifest
// under the 500-line cap, the same split that moved the technique classifiers out). The DATA — the
// TOGGLES array — stays in detection-matrix.ts; only its shape lives here. ──

export const ToggleTiming = z.enum([
  /** Read on every call: external env injection is honored mid-process. */
  'call-time',
  /** Read once when the server/object is built: tests reusing a prebuilt fixture miss it. */
  'construction-time',
  /** Read when pydantic Settings() loads: Python; per-test settings fixtures honor it. */
  'settings-load',
])
export type ToggleTiming = z.infer<typeof ToggleTiming>

export const ToggleGuard = z.enum([
  /** The read site honors the env var unconditionally: armable anywhere, including live pods. */
  'unguarded',
  /** Wrapped in NODE_ENV !== 'production': inert on deployed pods, so live-tier cells are n/a. */
  'node-env-gated',
  /** A pydantic Settings field (Python): armable wherever Settings() loads. */
  'settings-load',
])
export type ToggleGuard = z.infer<typeof ToggleGuard>

export const DetectionToggle = z.object({
  id: z.string(),
  env: z.object({ name: z.string(), value: z.string() }),
  component: z.string(),
  readSite: z.object({ file: z.string(), timing: ToggleTiming }),
  /** What the read site does with the env var — census-verified against the code, never asserted.
   *  node-env-gated drives the cluster tier's auto-n/a (the toggle is inert on live pods). */
  guard: ToggleGuard,
  /** What the repo SAYS catches this (null = nothing references the env; purely empirical). */
  designatedCatcher: z.string().nullable(),
  /** Cross-ref into claims.ts when this toggle already backs a permanent claim. */
  claimId: z.string().optional(),
  tiers: z.array(MatrixTier).min(1),
  /** Test files that arm/clear this env THEMSELVES (vitest file isolation contains it, but
   *  their verdicts under external injection invert: annotate, never naively count). */
  selfToggling: z.array(z.string()),
  notes: z.string().optional(),
})
export type DetectionToggle = z.infer<typeof DetectionToggle>

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
  /** Set once the key-gated eval groups have run clean (their reds merge into standing_reds);
   *  the llm tier refuses to verdict before this exists — eval spend deserves a real diff base. */
  llm_recorded_at: z.string().optional(),
})
export type MatrixBaseline = z.infer<typeof MatrixBaseline>

export const DetectionMatrixArtifact = z.object({
  schema_version: z.literal(1),
  generated_at: z.string(),
  baseline: MatrixBaseline.nullable(),
  cells: z.array(MatrixCell),
})
export type DetectionMatrixArtifact = z.infer<typeof DetectionMatrixArtifact>

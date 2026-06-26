/**
 * The single declarative roster of every runner that folds evidence into test-results/summary.json.
 *
 * META-COLLAPSE PR-A (additive; see GOODHART-TEST-AUDIT.md "Meta-layer collapse — design" + ADR-0028's
 * sibling registry work). Today this registry is NOT yet authoritative: scripts/test-results-verify.ts
 * still derives its roster from `*-results.ts` SOURCE via a regex (`deriveFoldedRunnerNames`) and
 * hand-classifies tiers in `RUNNER_TIERS`. scripts/lib/runners.test.ts proves RUNNERS is a faithful
 * SUPERSET of both, so PR-B can switch the census + claims-verify + a strengthened drift witness onto
 * this one source and delete the regex (killing the `spec`→`specPath` Goodhart distortion the
 * `(?!spec:)` lookahead forced).
 *
 * Why a registry beats the two-witness regex pair:
 *   - One declared home for {name, tier, how-it-folds}; adding/retiring a technique is ONE row, not a
 *     4-file drift-surface edit (deletion ergonomics).
 *   - It can carry the coverage:<backend> family (folded by coverage-results.ts under a DYNAMIC
 *     `name: s.runner`) that NEITHER current witness can see — a real silent gap, closed here.
 *   - PR-B's drift witness compares this DECLARED registry against the runners actually present in a
 *     real summary.json (an artifact produced independently of the registry) — "the fold ran" is a
 *     strictly stronger oracle than "a `name:` literal exists in source", and it is not a tautology.
 */

/** Where a runner runs — drives the census tier buckets (in-proc hard-required under --tier full,
 *  cluster deferred unless --tier full, optional never required). Mirrors test-results-verify's tiers. */
export type RunnerTier = 'in-proc' | 'cluster' | 'optional'

/**
 * How the runner's raw output becomes a summary.json runner. Drives the PR-B `scripts/fold.ts`
 * dispatcher routing:
 *   - 'vitest'   → foldVitestReport (read+parse a vitest json report)
 *   - 'eval'     → foldEvalRunner   (the deepeval/deepteam/pyrit pytest-summary shape)
 *   - 'custom'   → foldRunner with a tool-specific parse-fn (extracted to scripts/lib/parsers/ in PR-B)
 *   - 'external' → folded by its OWN standalone script (subprocess spawner or a --fold side-channel);
 *                  the dispatcher never owns it, the registry only records that it exists + its tier.
 */
export type FoldKind = 'vitest' | 'eval' | 'custom' | 'external'

export interface RunnerRow {
  readonly name: string
  readonly tier: RunnerTier
  readonly foldKind: FoldKind
  /** For 'external' rows only: the script/side-channel that folds it (the dispatcher does not own it). */
  readonly foldedBy?: string
}

export const RUNNERS: readonly RunnerRow[] = [
  // ── in-proc: CI's cheap in-process job; hard-required under --tier full ──────────────────────────
  { name: 'mbt-edge-coverage', tier: 'in-proc', foldKind: 'custom' },
  { name: 'web-component', tier: 'in-proc', foldKind: 'vitest' },
  { name: 'web-e2e', tier: 'in-proc', foldKind: 'custom' },

  // ── cluster: needs a live cluster or a model key; deferred unless --tier full ────────────────────
  { name: 'k6', tier: 'cluster', foldKind: 'custom' },
  { name: 'chaos', tier: 'cluster', foldKind: 'vitest' },
  { name: 'journey', tier: 'cluster', foldKind: 'vitest' },
  { name: 'tracetest', tier: 'cluster', foldKind: 'external', foldedBy: 'scripts/tracetest-results.ts' },
  { name: 'tenant-spans', tier: 'cluster', foldKind: 'external', foldedBy: 'scripts/check-tenant-spans.ts --fold' },
  { name: 'deepeval', tier: 'cluster', foldKind: 'eval' },
  { name: 'deepteam', tier: 'cluster', foldKind: 'eval' },
  { name: 'pyrit', tier: 'cluster', foldKind: 'eval' },
  { name: 'golden-sme', tier: 'cluster', foldKind: 'custom' },

  // ── optional: folded but gated on a heavyweight toolchain; never required by any tier ────────────
  { name: 'evomaster', tier: 'optional', foldKind: 'custom' },
  { name: 'moderator', tier: 'optional', foldKind: 'custom' },
  { name: 'stryker', tier: 'optional', foldKind: 'custom' },
  { name: 'pact', tier: 'optional', foldKind: 'external', foldedBy: 'scripts/pact-results.ts' },
  { name: 'schemathesis', tier: 'optional', foldKind: 'external', foldedBy: 'scripts/schemathesis-results.ts' },
  { name: 'scenario:content', tier: 'optional', foldKind: 'external', foldedBy: 'scripts/scenario-results.ts' },
  { name: 'scenario:flags', tier: 'optional', foldKind: 'external', foldedBy: 'scripts/scenario-results.ts' },

  // coverage family — all folded by coverage-results.ts. The web rows are the only ones the current
  // RUNNERS_WITHOUT_RESULTS_SCRIPT set tracks; the 5 backend rows fold under a DYNAMIC name and are
  // tracked by NEITHER current witness — closing that silent gap is the registry's forcing function.
  { name: 'coverage', tier: 'optional', foldKind: 'external', foldedBy: 'scripts/coverage-results.ts' },
  { name: 'coverage:web-component', tier: 'optional', foldKind: 'external', foldedBy: 'scripts/coverage-results.ts' },
  { name: 'coverage:web-node', tier: 'optional', foldKind: 'external', foldedBy: 'scripts/coverage-results.ts' },
  { name: 'coverage:content', tier: 'optional', foldKind: 'external', foldedBy: 'scripts/coverage-results.ts' },
  { name: 'coverage:donations', tier: 'optional', foldKind: 'external', foldedBy: 'scripts/coverage-results.ts' },
  { name: 'coverage:flags', tier: 'optional', foldKind: 'external', foldedBy: 'scripts/coverage-results.ts' },
  { name: 'coverage:gateway', tier: 'optional', foldKind: 'external', foldedBy: 'scripts/coverage-results.ts' },
  { name: 'coverage:identity', tier: 'optional', foldKind: 'external', foldedBy: 'scripts/coverage-results.ts' },
]

/** The coverage:<backend> rows neither current witness can see (folded under a dynamic name). The
 *  superset proof asserts these are net-new vs RUNNER_TIERS — i.e. the gap the registry closes. */
export const COVERAGE_BACKEND_GAP: readonly string[] = [
  'coverage:content',
  'coverage:donations',
  'coverage:flags',
  'coverage:gateway',
  'coverage:identity',
]

export const runnerNames = (): Set<string> => new Set(RUNNERS.map((r) => r.name))

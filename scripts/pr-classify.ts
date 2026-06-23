/**
 * PR classifier for the auto-merge router (ADR-0026).
 *
 * A PURE function: `(changed files + diff churn) -> {lane, reasons}`. No git, no GitHub API, no
 * filesystem — so the routing logic is itself offline-testable and falsifiable (feed it the
 * worked examples from ADR-0026, assert the lane). The workflow layer does the I/O (read
 * CODEOWNERS, run `git diff`) and calls in here.
 *
 * Three lanes (ADR-0026):
 *   A  bot auto-merges      — safe, small, single boundary, no gate/invariant touch
 *   B  pre-digested human   — cross-boundary, too big, or an enforcement (gate) edit
 *   C  Code Owner review    — touches an invariant source (CODEOWNERS owns this)
 *
 * First match wins: invariant -> C, any gate touch -> B, (>1 boundary OR over size cap) -> B,
 * else -> A.
 */

/** Per-file diff churn (additions + deletions). The workflow fills this from `git diff --numstat`. */
export type ChangedFile = { readonly path: string; readonly churn: number }

export type Lane = 'A' | 'B' | 'C'

export type ClassifyResult = { readonly lane: Lane; readonly reasons: readonly string[] }

/** Max churn for an auto-merge-eligible PR (ADR-0026). Lockfiles/generated/snapshots excluded. */
export const SIZE_CAP = 400

/**
 * Paths that ARE enforcement (gates). Editing one is never auto-mergeable — at minimum a human
 * reads it (Lane B). The classifier itself lives under `scripts/`, so it eats its own dogfood:
 * a PR that edits this file lands in Lane B. (ADR-0026)
 */
export const GATE_GLOBS: readonly string[] = [
  '/scripts/**',
  '/tools/eslint-plugin-qaroom/**',
  '/.github/workflows/**',
]

/**
 * The detection-matrix + claims manifests. Touching one means a technique was added/changed
 * (ADR-0026). They are ALSO invariant paths in CODEOWNERS, so they route to C either way; this
 * list only annotates the reason. Kept as a marker, not a lane driver.
 */
const MANIFEST_GLOBS: readonly string[] = [
  '/scripts/lib/manifests/claims.ts',
  '/scripts/lib/manifests/detection-matrix.ts',
]

/** Excluded from the size count: machine-written or regenerated, not hand-authored risk. */
function isSizeExcluded(path: string): boolean {
  return (
    path.endsWith('pnpm-lock.yaml') ||
    path.endsWith('.snap') ||
    path.endsWith('openapi.yaml') ||
    path.includes('/generated/') ||
    path.startsWith('generated/')
  )
}

/**
 * Minimal gitignore/CODEOWNERS-style matcher. Handles exactly the two shapes the invariant +
 * gate lists use: a root-anchored directory glob (`/dir/**`) and an exact file (`/dir/file.ts`).
 *
 * ponytail: deliberately not a full globber. Ceiling = no mid-pattern `*`, no `?`, no negation.
 * Upgrade path: drop in `minimatch` if CODEOWNERS ever grows fancier patterns. The matcher's
 * job is asserted by pr-classify.test.ts against the real CODEOWNERS entries.
 */
export function matchesGlob(path: string, pattern: string): boolean {
  const p = pattern.startsWith('/') ? pattern.slice(1) : pattern
  if (p.endsWith('/**')) {
    const prefix = p.slice(0, -3)
    return path === prefix || path.startsWith(`${prefix}/`)
  }
  return path === p
}

function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesGlob(path, pattern))
}

/**
 * The blast-radius unit for a changed file: `services/<x>` or `packages/<x>`, else the top-level
 * dir (`docs`, `deploy`, `.github`), else `repo-root` for a bare root file. >1 distinct unit in a
 * PR = a cross-boundary change a human should at least skim (Lane B).
 */
export function boundaryOf(path: string): string {
  const segments = path.split('/')
  if ((segments[0] === 'services' || segments[0] === 'packages') && segments.length >= 2) {
    return `${segments[0]}/${segments[1]}`
  }
  return segments.length > 1 ? segments[0] : 'repo-root'
}

/**
 * Parse the invariant-source globs out of CODEOWNERS text — the SINGLE source for what is
 * load-bearing (same discipline as invariant-guard.yml: never re-list these paths). Each non-empty
 * non-comment line is `<glob>  <owner...>`; we keep the glob (first token).
 */
export function loadInvariantGlobs(codeownersText: string): readonly string[] {
  return codeownersText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.split(/\s+/)[0])
    .filter((glob): glob is string => Boolean(glob))
}

/**
 * Classify a PR. `invariantGlobs` comes from {@link loadInvariantGlobs} over the repo's CODEOWNERS.
 */
export function classify(
  files: readonly ChangedFile[],
  invariantGlobs: readonly string[],
): ClassifyResult {
  if (files.length === 0) {
    return { lane: 'A', reasons: ['no changed files'] }
  }

  const invariantHits = files.filter((f) => matchesAny(f.path, invariantGlobs))
  if (invariantHits.length > 0) {
    const manifestHit = invariantHits.some((f) => matchesAny(f.path, MANIFEST_GLOBS))
    const reasons = [
      `invariant source touched: ${invariantHits.map((f) => f.path).join(', ')}`,
      ...(manifestHit ? ['new/changed technique (detection-matrix or claims manifest)'] : []),
    ]
    return { lane: 'C', reasons }
  }

  const gateHits = files.filter((f) => matchesAny(f.path, GATE_GLOBS))
  if (gateHits.length > 0) {
    const nonGate = files.length - gateHits.length
    const reason =
      nonGate > 0
        ? `gate self-weakening: edits enforcement (${gateHits
            .map((f) => f.path)
            .join(', ')}) AND other code in one diff`
        : `enforcement (gate) edit needs a human: ${gateHits.map((f) => f.path).join(', ')}`
    return { lane: 'B', reasons: [reason] }
  }

  // Machine-written files (lockfiles, generated, snapshots, regenerated specs) are noise for both
  // size AND boundary count — a regenerated lockfile is not a "second boundary" a human must skim.
  const handAuthored = files.filter((f) => !isSizeExcluded(f.path))
  const boundaries = [...new Set(handAuthored.map((f) => boundaryOf(f.path)))]
  const size = handAuthored.reduce((sum, f) => sum + f.churn, 0)

  const reasons: string[] = []
  if (boundaries.length > 1) {
    reasons.push(`crosses ${boundaries.length} boundaries: ${boundaries.join(', ')}`)
  }
  if (size > SIZE_CAP) {
    reasons.push(`size ${size} > cap ${SIZE_CAP}`)
  }
  if (reasons.length > 0) {
    return { lane: 'B', reasons }
  }

  return {
    lane: 'A',
    reasons: [
      `single boundary: ${boundaries[0] ?? 'machine-written files only'}`,
      `size ${size} <= cap ${SIZE_CAP}`,
    ],
  }
}

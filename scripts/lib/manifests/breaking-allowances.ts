/**
 * DECLARED breaking contract changes (AGENTS.md merge bar 3: "oasdiff reports no *undeclared*
 * breaking changes"). Until now nothing implemented the "declared" half — there was no way to
 * say "yes, this one is intentional", because there was also no gate that could report an
 * undeclared one.
 *
 * An entry is a deliberate decision with a reason, in the same spirit as `census.ts`'s
 * allowlisted-with-reason entries and the drift-gate exemptions in `workspace-script.ts`. Adding
 * one should be as visible in review as the breaking change itself, so keep the reason specific:
 * who consumes this contract, and why they are safe.
 *
 * Entries are matched on (service, spec, path) — an allowance for one path never silently
 * covers another. Removing the change removes the need for the entry; stale entries are reported
 * by the gate rather than lingering.
 */
export interface BreakingAllowance {
  /** Service directory name, e.g. `content`. */
  service: string
  /** Which contract the change is in. */
  spec: 'openapi' | 'asyncapi'
  /** The exact change path the classifier reports, e.g. `/channels/postCreated/address`. */
  path: string
  /** Why this breaking change is acceptable. Name the consumers and why they are safe. */
  reason: string
}

export const BREAKING_ALLOWANCES: readonly BreakingAllowance[] = []

/** True when a classified change at `path` is a declared, intentional break. */
export function isDeclared(service: string, spec: 'openapi' | 'asyncapi', path: string): boolean {
  return BREAKING_ALLOWANCES.some(
    (a) => a.service === service && a.spec === spec && a.path === path,
  )
}

/**
 * Allowances that no longer match any reported change. A stale allowance is debt: it silently
 * pre-approves a future break at the same path.
 */
export function staleAllowances(
  reported: ReadonlyArray<{ service: string; spec: 'openapi' | 'asyncapi'; path: string }>,
): BreakingAllowance[] {
  return BREAKING_ALLOWANCES.filter(
    (a) =>
      !reported.some((r) => r.service === a.service && r.spec === a.spec && r.path === a.path),
  )
}

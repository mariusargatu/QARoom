import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BOUNDARY_REGISTRY } from './lib/manifests/boundary-registry'
import { CLAIMS } from './lib/manifests/claims'

/**
 * `pnpm anchored:coverage`: the anchored-severity-coverage sidecar (T23, ADR-0033). A Tier-0 anchor is
 * a falsifiable claim that OWNS a boundary — a human-independent, agent-immutable trust anchor. A
 * documented boundary with NO owning claim has no anchor: its only evidence is whatever the agent's own
 * gates report, exactly the trust the threat model withdraws.
 *
 * This computes, per documented boundary that maps a gate lane, whether a claim owns it, and writes the
 * ratio to a SEPARATE evidence file (`test-results/anchored-coverage.json`) — NOT
 * `test-results/summary.json`, whose schema is FROZEN (a sidecar, per the card).
 *
 * It is ADVISORY by design. Many boundaries are legitimately claim-free for now (temporal,
 * identity-issuance, payment-edge); a HARD floor would force a fake claim to go green, the exact
 * Goodhart failure this whole experiment guards against. So it REPORTS the unanchored boundaries as the
 * "boundary with no owning claim" signal and exits 0. Turning it into a binding ratchet on the diff is
 * deferred to T24's tiering (named, not built).
 */
const ROOT = process.cwd()
const OUT = resolve(ROOT, 'test-results/anchored-coverage.json')

interface BoundaryCoverage {
  readonly id: string
  readonly label: string
  /** The claims whose registryRow owns this boundary (its Tier-0 anchors). */
  readonly anchoredBy: string[]
  readonly anchored: boolean
}

function main(): void {
  // Anchorable = a documented boundary that maps at least one gate lane. Doc-level composites with no
  // lane of their own (e.g. `state`) have no gate to anchor, so they are out of the denominator.
  const anchorable = BOUNDARY_REGISTRY.filter((b) => b.lanes.length > 0)
  const coverage: BoundaryCoverage[] = anchorable.map((b) => {
    const anchoredBy = CLAIMS.filter((c) => c.registryRow === b.id).map((c) => c.id)
    return { id: b.id, label: b.label, anchoredBy, anchored: anchoredBy.length > 0 }
  })
  const anchored = coverage.filter((c) => c.anchored)
  const unanchored = coverage.filter((c) => !c.anchored)
  const ratio = anchorable.length === 0 ? 1 : anchored.length / anchorable.length

  const sidecar = {
    schema_version: 1,
    // Build tooling, not service runtime: a wall-clock stamp is fine here (see claim-evidence.ts).
    generated_at: new Date().toISOString(),
    anchored_ratio: Number(ratio.toFixed(4)),
    anchorable_boundaries: anchorable.length,
    anchored_boundaries: anchored.length,
    total_claims: CLAIMS.length,
    unanchored: unanchored.map((c) => c.id),
    by_boundary: coverage,
  }
  mkdirSync(resolve(ROOT, 'test-results'), { recursive: true })
  writeFileSync(OUT, `${JSON.stringify(sidecar, null, 2)}\n`)

  process.stdout.write(
    `anchored:coverage: ${anchored.length}/${anchorable.length} boundaries anchored by a falsifiable claim (ratio ${sidecar.anchored_ratio}) → ${OUT}\n`,
  )
  if (unanchored.length > 0) {
    // The "boundary with no owning claim" signal — advisory, never a build failure (no fake claims).
    process.stdout.write(
      `  ⚠ ${unanchored.length} boundary(ies) have NO owning claim (no Tier-0 anchor): ${unanchored
        .map((c) => c.id)
        .join(', ')}\n`,
    )
    process.stdout.write(
      `  ${'(advisory: a binding anchored-ratio ratchet is deferred to T24 tiering — ADR-0033)'}\n`,
    )
  }
}

main()

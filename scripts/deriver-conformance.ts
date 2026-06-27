import { auditVoteValueArbConformance } from '@qaroom/testing-utils/agentic'

/**
 * `pnpm deriver:verify`: the derivation-chain conformance gate (T23, ADR-0033). Governing the SOURCE
 * (the CODEOWNED `VOTE_VALUES`) is not enough — the cheapest tamper leaves the invariant pristine and
 * weakens the ungoverned DERIVER (the property generator). This recomputes the expected ±1 set straight
 * from the source and diffs it against what the live vote-value arbitrary actually emits (sampled,
 * deterministic seed). A faithful deriver matches; a weakened one — the `AGENT_WEAKEN_VOTE_DERIVER`
 * toggle, or a hand-edit that swaps the engine — reds. Wired into `pnpm verify` and CI; its in-process
 * twin is the `deriver-conformance` claim's vitest gate.
 */
function main(): void {
  const result = auditVoteValueArbConformance()
  if (result.ok) {
    process.stdout.write(`deriver:verify ✓: ${result.detail}\n`)
    return
  }
  process.stderr.write(`deriver:verify FAILED: ${result.detail}\n`)
  process.stderr.write(
    `  expected (recomputed from VOTE_VALUES): {${result.expected.join(', ')}}\n`,
  )
  process.stderr.write(
    `  observed (sampled live deriver):        {${result.observed.join(', ')}}\n`,
  )
  process.exit(1)
}

main()

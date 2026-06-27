import { execFileSync } from 'node:child_process'

/**
 * Run Stryker mutation testing against the TESTING HARNESS itself — the testing-utils core that every
 * suite is built on (ADR-0031, T18-core). This is a SEPARATE surface from `stryker-critical.ts`: that
 * one meta-tests the locked-6 PRODUCT modules (governed by ADR-0016 §11); this one asks the same
 * question one level down — *are the harness's own tests any good?* A weakened assertion in the
 * harness passes invisibly and every downstream suite inherits the false green, so the harness needs
 * the same self-check the product modules get.
 *
 * The scope is BOUNDED to two pure, co-located-tested core modules (the scenario runner + the AsyncAPI
 * drift classifier) so a local run is fast (`packages/testing-utils/stryker.config.json` +
 * `vitest.stryker.config.ts`). The broader harness surface — the pglite fixture, migration discipline,
 * and the matchers — is the dispatched nightly extension named in ADR-0031, not this fast gate. The
 * JSON report lands in `test-results/stryker-harness/` (a subfolder), deliberately OUTSIDE the
 * `test-results/stryker-*.json` glob that `stryker-results.ts` folds into the locked-critical lane, so
 * the two surfaces never bleed into one summary.
 *
 * Exits non-zero if the package falls below its `thresholds.break` floor.
 */
const PACKAGE = '@qaroom/testing-utils'

process.stdout.write(`\n=== Stryker (harness core): ${PACKAGE} ===\n`)
try {
  execFileSync('pnpm', ['--filter', PACKAGE, 'exec', 'stryker', 'run'], { stdio: 'inherit' })
} catch {
  process.stderr.write(`Stryker fell below break threshold for ${PACKAGE}\n`)
  process.exit(1)
}

process.exit(0)

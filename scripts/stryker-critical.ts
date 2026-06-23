import { execFileSync } from 'node:child_process'

/**
 * Run Stryker mutation testing across the critical-modules packages (docs/03 §11). Each package owns
 * a scoped `stryker.config.json` + `vitest.stryker.config.ts` and enforces its own `thresholds.break`.
 * The fast tier (pure logic, in-process tests) runs by default. Two domain-critical modules
 * (content voting score, flags resolution) do NOT yet have a `stryker.config.json` — wiring them is
 * tracked but not yet implemented; do not read this list as covering them. See ADR-0016.
 *
 * Runs every package even if one fails its break threshold, then `pnpm stryker:results` folds the
 * JSON reports into summary.json. Exits non-zero if any package fell below its break.
 */
const FAST_TIER = [
  '@qaroom/contracts',
  '@qaroom/service-kit',
  '@qaroom/gateway',
  '@qaroom/donations',
  '@qaroom/identity',
  // webhooks owns the repo's riskiest math (retry/backoff, HMAC signing, at-least-once + receiver
  // dedup); its stryker.config.json + property suites existed but were never invoked until wired here.
  '@qaroom/webhooks',
]

let anyFailed = false
for (const pkg of FAST_TIER) {
  process.stdout.write(`\n=== Stryker: ${pkg} ===\n`)
  try {
    execFileSync('pnpm', ['--filter', pkg, 'exec', 'stryker', 'run'], { stdio: 'inherit' })
  } catch {
    anyFailed = true
    process.stderr.write(`Stryker fell below break threshold for ${pkg}\n`)
  }
}

process.exit(anyFailed ? 1 : 0)

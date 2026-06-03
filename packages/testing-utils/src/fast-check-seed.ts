import fc from 'fast-check'

/**
 * Property tests run with a fixed seed by default so CI is reproducible and
 * flake-free. Override with `VITEST_SEED=<n> pnpm test` to replay a reported
 * failure. The seed reporter records the active seed into `summary.json`, and
 * because generation is seed-deterministic, replaying the seed reproduces the
 * exact failing case (Milestone 0 exit criterion 7).
 */
const DEFAULT_SEED = 0xc0ffee

function activeSeed(): number {
  const env = process.env.VITEST_SEED
  return env !== undefined && env !== '' ? Number(env) : DEFAULT_SEED
}

export function configureFastCheck(): number {
  const seed = activeSeed()
  fc.configureGlobal({ seed, numRuns: 100 })
  return seed
}

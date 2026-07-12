// Self-reference via the package export (not a relative path): the Vitest config loader resolves
// package exports but not extensionless relative .ts imports at config-load time.
import { contentionAwareTimeout } from '@qaroom/testing-utils/vitest-timeouts'
import { defineConfig } from 'vitest/config'

export interface ServiceConfigOptions {
  /**
   * Pact / Testcontainers lanes (gateway) need a flat, generous budget rather than the PGlite
   * contention cap, and run single-suite so the 2-worker cap does not apply.
   */
  pact?: boolean
  /** Extra coverage `exclude` globs on top of the shared defaults. */
  coverageExclude?: string[]
}

/**
 * The single source of truth for a backend service's Vitest config. Each service's
 * `vitest.config.ts` becomes `export default defineServiceConfig()` (or `{ pact: true }` for
 * gateway). Folds in the shared determinism setup, the contention-aware timeout caps, and v8
 * coverage with the `json-summary` reporter the coverage fold reads. See UNIT-L1-PLAN.md §3.4/§4.
 */
export function defineServiceConfig(opts: ServiceConfigOptions = {}) {
  const testTimeout = opts.pact ? 60_000 : contentionAwareTimeout(60_000)
  const hookTimeout = opts.pact ? 60_000 : contentionAwareTimeout(30_000)

  return defineConfig({
    test: {
      globals: true,
      setupFiles: ['@qaroom/testing-utils/setup'],
      testTimeout,
      hookTimeout,
      // 2 workers/suite: each hosts a PGlite (wasm, CPU-bound) and a turbo sweep runs several at
      // once. The Pact lane runs single-suite, so the cap is unnecessary (and would slow it).
      ...(opts.pact ? {} : { maxWorkers: 2 }),
      coverage: {
        provider: 'v8',
        // json-summary is load-bearing — scripts/coverage-results.ts folds its coverage-summary.json.
        reporter: ['text', 'json-summary', 'lcovonly'],
        reportsDirectory: 'coverage',
        include: ['src/**/*.ts'],
        exclude: [
          'src/**/*.test.ts', // also covers *.property.test.ts
          'src/**/*.spec.ts',
          'src/server.ts',
          'src/telemetry.ts',
          'src/**/openapi-build.ts',
          'src/**/asyncapi-build.ts',
          'src/**/openapi-document.ts',
          'src/**/asyncapi-document.ts',
          ...(opts.coverageExclude ?? []),
        ],
      },
    },
  })
}

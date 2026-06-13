import { contentionAwareTimeout } from '@qaroom/testing-utils/vitest-timeouts'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['@qaroom/testing-utils/setup'],
    // Caps are hung-test guards, not budgets. The PGlite-heavy properties stretch
    // linearly with host contention (k3d cluster, act runners, the rest of a turbo
    // sweep), so the cap scales with loadavg/cores — tight when quiet, honest when
    // the machine is already starved. See @qaroom/testing-utils/vitest-timeouts.
    testTimeout: contentionAwareTimeout(60_000),
    // 2 workers/suite: each worker hosts PGlite (wasm, CPU-bound) and a turbo
    // sweep runs several of these suites at once — unbounded is 6 suites x 12
    // default workers on 12 cores.
    maxWorkers: 2,
    hookTimeout: contentionAwareTimeout(30_000),
  },
})

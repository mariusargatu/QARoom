import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    // configureFastCheck() pins the property-test seed from VITEST_SEED (Milestone 0 discipline).
    setupFiles: ['@qaroom/testing-utils/setup'],
    testTimeout: 30_000,
  },
})

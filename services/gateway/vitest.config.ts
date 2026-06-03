import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['@qaroom/testing-utils/setup'],
    // Pact + Testcontainers-backed provider verification need a generous budget.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})

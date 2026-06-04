import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['@qaroom/testing-utils/setup'],
    testTimeout: 30_000,
  },
})

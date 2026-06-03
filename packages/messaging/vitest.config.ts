import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['@qaroom/testing-utils/setup'],
    // Property tests spin a fresh pglite per generated case; give them room.
    testTimeout: 30_000,
  },
})

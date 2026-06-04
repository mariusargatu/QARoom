import { defineConfig } from 'vitest/config'

// Web unit tests (api client, pure helpers). Component behavior is covered by Playwright CT
// and Storybook play() (ADR-0005), not by Vitest DOM rendering, so a plain node env suffices.
export default defineConfig({
  test: {
    environment: 'node',
    passWithNoTests: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})

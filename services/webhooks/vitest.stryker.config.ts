import { defineConfig } from 'vitest/config'

// Scoped Vitest config for Stryker (Milestone 11): the in-process (pglite, programmable
// WebhookSender double, FakeClock) property suites that cover the delivery worker — the retry
// contract, at-least-once delivery, and receiver-dedup. Excludes the Pact/MBT specs under tests/
// that need NATS/Testcontainers. See services/webhooks/stryker.config.json.
export default defineConfig({
  test: {
    include: [
      'src/delivery-guarantee.property.test.ts',
      'src/redelivery-dedup.property.test.ts',
      'src/retry-schedule.property.test.ts',
    ],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})

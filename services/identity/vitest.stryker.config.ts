import { defineConfig } from 'vitest/config'

// Scoped Vitest config for Stryker: the suite covering the mutated WS-ticket store (ticket-store.ts,
// added to §11 in ADR-0016's 2026-06-19 addendum). ticket-store.test.ts is its full unit guard —
// one-use redemption (delete-before-expiry), the 30s expiry boundary, and the sweep — driven by a
// FakeClock so every mutant is deterministic. The pglite/Pact/property suites stay out (they don't
// touch the mutated module), keeping the per-mutant re-run fast.
export default defineConfig({
  test: {
    include: ['src/ticket-store.test.ts'],
  },
})

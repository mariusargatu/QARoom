import { defineConfig } from 'vitest/config'

// Scoped Vitest config for the harness-core Stryker lane (ADR-0031, T18-core). The mutated modules are
// the scenario runner (run-scenario.ts: captureScenario / structuralFingerprint / runTwiceAndDiff —
// the determinism scaffolding every fault-scenario catalog trusts) and two of the seeded determinism
// doubles (seeded-randomness.ts + fake-clock.ts — the trio every test builds its world on). All three
// are PURE — no PGlite, no Testcontainers — so each per-mutant re-run stays sub-second and the bounded
// local pass is fast. Their co-located unit guards are the only suites included; the pglite/Pact/
// property suites stay out because they don't touch the mutated modules, and the broader harness
// surface (the pglite fixture + migration discipline + the matchers) is the dispatched nightly
// extension, not this bounded gate.
export default defineConfig({
  test: {
    include: [
      'src/scenario/run-scenario.test.ts',
      'src/determinism/seeded-randomness.test.ts',
      'src/determinism/fake-clock.test.ts',
    ],
  },
})

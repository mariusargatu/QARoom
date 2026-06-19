import { defineServiceConfig } from '@qaroom/testing-utils/vitest-config'

// Pact + Testcontainers provider verification: flat generous budget, single-suite (no worker cap).
export default defineServiceConfig({ pact: true })

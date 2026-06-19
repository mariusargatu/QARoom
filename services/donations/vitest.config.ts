import { defineServiceConfig } from '@qaroom/testing-utils/vitest-config'

// Shared base: globals + determinism setup + contention-aware caps + v8 coverage. See UNIT-L1-PLAN.md §3.4.
export default defineServiceConfig()

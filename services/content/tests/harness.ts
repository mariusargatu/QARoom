import { EXAMPLE_COMMUNITY_ID, EXAMPLE_USER_ID } from '@qaroom/contracts'
import type { SeedConfig } from '@qaroom/testing-utils/harness'
import { injectClient, setupServiceTest } from '@qaroom/testing-utils/harness'
import { buildApp } from '../src/app'
import { resolveFaults } from '../src/config/faults'
import { ensureSchema } from '../src/db/migrate'
import type { FaultConfig } from '../src/deps'
import { asContentDb } from './db-cast'

/**
 * Per-test content-service harness: fresh pglite + seeded determinism + a wired app, plus the shared
 * inject request client. The pglite→ContentDb cast lives in `./db-cast` so repository/route code stays
 * driver-agnostic.
 *
 * `faults` defaults to `resolveFaults()` so an env-armed run (e.g. `pnpm prove tenant-isolation
 * --break`, the detection-matrix in-proc tier) still arms the deliberate bug; a clean run resolves to
 * all-off. Pass an explicit (optionally mutable) `faults` to exercise a switch without touching env.
 */
export async function setupContentTest(seed?: SeedConfig, faults: FaultConfig = resolveFaults()) {
  const ctx = await setupServiceTest({
    applyMigrations: (db) => ensureSchema(db),
    createApp: (deps) =>
      buildApp({
        db: asContentDb(deps.db),
        clock: deps.clock,
        ids: deps.ids,
        randomness: deps.randomness,
        faults,
      }),
    seed,
  })
  return { ...ctx, request: injectClient(ctx.app) }
}

/** Valid example identifiers for tests (communityB differs from A for isolation tests). */
export const SAMPLE = {
  communityA: EXAMPLE_COMMUNITY_ID,
  communityB: 'comm_01HZY0K7M3QF8VN2J5RX9TB4CE',
  user: EXAMPLE_USER_ID,
} as const

import { EXAMPLE_COMMUNITY_ID, EXAMPLE_USER_ID } from '@qaroom/contracts'
import type { SeedConfig } from '@qaroom/testing-utils/harness'
import { injectClient, setupServiceTest } from '@qaroom/testing-utils/harness'
import { buildApp } from '../src/app'
import type { ContentDb } from '../src/db/client'
import { ensureSchema } from '../src/db/migrate'

/**
 * Per-test content-service harness: fresh pglite + seeded determinism + a wired app,
 * plus the shared inject request client. The pglite→ContentDb cast lives here at the
 * boundary so repository/route code stays driver-agnostic.
 */
export async function setupContentTest(seed?: SeedConfig) {
  const ctx = await setupServiceTest({
    applyMigrations: (db) => ensureSchema(db),
    createApp: (deps) =>
      buildApp({
        db: deps.db as unknown as ContentDb,
        clock: deps.clock,
        ids: deps.ids,
        randomness: deps.randomness,
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

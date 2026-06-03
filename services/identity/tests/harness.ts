import { COMM_GENERAL, EXAMPLE_USER_ID } from '@qaroom/contracts'
import type { SeedConfig } from '@qaroom/testing-utils/harness'
import { injectClient, setupServiceTest } from '@qaroom/testing-utils/harness'
import type { BuiltIdentity } from '../src/app'
import { buildIdentity } from '../src/app'
import type { IdentityDb } from '../src/db/client'
import { ensureSchema } from '../src/db/migrate'
import type { RotationConfig } from '../src/keys'
import { TestKeyMaterialSource } from './fixtures/test-key-material'

/** Grace window in test config (ADR-0008): 1h logical time, vs 24h in production. */
export const TEST_GRACE_MS = 60 * 60 * 1000

export interface IdentityTestOptions {
  seed?: SeedConfig
  rotation?: RotationConfig
  tokenTtlSeconds?: number
}

/**
 * Per-test identity-service harness: fresh pglite + seeded determinism + a wired app, plus
 * the SAME KeyStore and Issuer the app uses (so JWT/rotation property tests can drive them
 * directly while the HTTP surface stays consistent). The general community is seeded by
 * `ensureSchema` (the migration's up step).
 */
export async function setupIdentityTest(opts: IdentityTestOptions = {}) {
  let built: BuiltIdentity | undefined
  const ctx = await setupServiceTest({
    applyMigrations: (db) => ensureSchema(db),
    createApp: (deps) => {
      built = buildIdentity({
        db: deps.db as unknown as IdentityDb,
        clock: deps.clock,
        ids: deps.ids,
        randomness: deps.randomness,
        keyMaterial: new TestKeyMaterialSource(),
        rotation: opts.rotation ?? { graceMs: TEST_GRACE_MS },
        tokenTtlSeconds: opts.tokenTtlSeconds ?? 3600,
      })
      return built.app
    },
    seed: opts.seed,
  })
  const resolved = built as BuiltIdentity
  return {
    ...ctx,
    request: injectClient(ctx.app),
    keyStore: resolved.keyStore,
    issuer: resolved.issuer,
  }
}

/** Valid example identifiers for tests. communityA/B differ for isolation tests. */
export const SAMPLE = {
  communityGeneral: COMM_GENERAL,
  user: EXAMPLE_USER_ID,
} as const

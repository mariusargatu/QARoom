import { CryptoRandomness, SystemClock, UlidIdGenerator } from '@qaroom/determinism'
import { runProviderVerification } from '@qaroom/testing-utils/contracts'
import { buildApp } from '../../src/app'
import { ensureSchema } from '../../src/db/migrate'
import { schema } from '../../src/db/schema'

/**
 * Provider verification for flags-service — see `runProviderVerification`. No state handlers are
 * needed: an unknown flag resolves to the rollout's initial `Off`, and `EnableRequested` is a legal
 * transition from `Off`, so the gateway's replayed requests succeed against a fresh DB. The injected
 * no-op transition sink keeps verification to the HTTP contract (the span emission lives in @qaroom/otel).
 * Run via `pnpm pact:verify --provider flags` (needs Docker; not part of the unit suite).
 */
await runProviderVerification({
  provider: 'flags',
  scriptDir: import.meta.dirname,
  schema,
  ensureSchema,
  buildApp: (db) =>
    buildApp({
      db,
      clock: new SystemClock(),
      ids: new UlidIdGenerator(),
      randomness: new CryptoRandomness(),
      transitionSink: { record: () => {} },
    }),
})

import { CryptoRandomness, SystemClock, UlidIdGenerator } from '@qaroom/determinism'
import { runProviderVerification } from '@qaroom/testing-utils/contracts'
import { buildApp } from '../../src/app'
import { runIdentityMigration } from '../../src/db/migrate'
import { schema, signingKeys } from '../../src/db/schema'
import { ProductionKeyMaterialSource } from '../../src/keys'
import { TEST_PRIVATE_JWK, TEST_PUBLIC_JWK } from '../fixtures/test-key-material'

/**
 * Provider verification for identity-service — see `runProviderVerification`. The 'a signing key
 * exists' handler seeds the deterministic fixture key under the kid the consumer expects, so
 * GET /jwks.json returns it. (Identity provisions its schema via `runIdentityMigration`.)
 * Run via `pnpm pact:verify --provider identity` (needs Docker; not part of the unit suite).
 */
await runProviderVerification({
  provider: 'identity',
  scriptDir: import.meta.dirname,
  schema,
  ensureSchema: (db) => runIdentityMigration(db, { clock: new SystemClock() }),
  buildApp: (db) =>
    buildApp({
      db,
      clock: new SystemClock(),
      ids: new UlidIdGenerator(),
      randomness: new CryptoRandomness(),
      keyMaterial: new ProductionKeyMaterialSource(),
    }),
  stateHandlers: (db) => ({
    'a signing key exists': async (params) => {
      const p = params as Record<string, string>
      const kid = p.kid ?? 'key_01HZY0K7M3QF8VN2J5RX9TB4CH'
      await db
        .insert(signingKeys)
        .values({
          kid,
          alg: 'ES256',
          publicJwk: { ...TEST_PUBLIC_JWK, kid, use: 'sig', alg: 'ES256' },
          privateJwk: TEST_PRIVATE_JWK,
          status: 'current',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          retiredAt: null,
        })
        .onConflictDoNothing()
      return { description: `seeded signing key ${kid}` }
    },
  }),
})

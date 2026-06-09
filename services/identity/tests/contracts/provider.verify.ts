import { EXAMPLE_COMMUNITY_ID, EXAMPLE_USER_ID } from '@qaroom/contracts'
import { CryptoRandomness, SystemClock, UlidIdGenerator } from '@qaroom/determinism'
import { runProviderVerification } from '@qaroom/testing-utils/contracts'
import { buildApp } from '../../src/app'
import { runIdentityMigration } from '../../src/db/migrate'
import { communities, memberships, schema, signingKeys, users } from '../../src/db/schema'
import { ProductionKeyMaterialSource } from '../../src/keys'
import { TEST_PRIVATE_JWK, TEST_PUBLIC_JWK } from '../fixtures/test-key-material'

const SEED_AT = new Date('2026-01-01T00:00:00.000Z')
// Handles/slugs are derived from the (lowercased) branded id so seeding any id is collision-free:
// the prefixed-ULID lowercases into the [a-z0-9_] handle/slug alphabet and is unique per id.
const seededHandle = (userId: string) => userId.toLowerCase()
const seededSlug = (communityId: string) => communityId.toLowerCase()

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
  stateHandlers: (db) => {
    const seedUser = async (userId: string) => {
      await db
        .insert(users)
        .values({
          id: userId,
          handle: seededHandle(userId),
          displayName: 'Seeded User',
          createdAt: SEED_AT,
        })
        .onConflictDoNothing()
    }
    const seedCommunity = async (communityId: string) => {
      await db
        .insert(communities)
        .values({
          id: communityId,
          slug: seededSlug(communityId),
          name: 'Seeded Community',
          createdAt: SEED_AT,
        })
        .onConflictDoNothing()
    }
    return {
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
            createdAt: SEED_AT,
            retiredAt: null,
          })
          .onConflictDoNothing()
        return { description: `seeded signing key ${kid}` }
      },
      'a user exists': async (params) => {
        const userId = (params as Record<string, string>).user_id ?? EXAMPLE_USER_ID
        await seedUser(userId)
        return { description: `seeded user ${userId}` }
      },
      'a community exists': async (params) => {
        const communityId = (params as Record<string, string>).community_id ?? EXAMPLE_COMMUNITY_ID
        await seedCommunity(communityId)
        return { description: `seeded community ${communityId}` }
      },
      'a membership exists': async (params) => {
        const p = params as Record<string, string>
        const userId = p.user_id ?? EXAMPLE_USER_ID
        const communityId = p.community_id ?? EXAMPLE_COMMUNITY_ID
        await seedUser(userId)
        await seedCommunity(communityId)
        await db
          .insert(memberships)
          .values({ userId, communityId, role: 'member', joinedAt: SEED_AT })
          .onConflictDoNothing()
        return { description: `seeded membership ${userId}@${communityId}` }
      },
    }
  },
})

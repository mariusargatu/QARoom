import { CryptoRandomness, SystemClock, UlidIdGenerator } from '@qaroom/determinism'
import { runProviderVerification } from '@qaroom/testing-utils/contracts'
import { eq } from 'drizzle-orm'
import { buildApp } from '../../src/app'
import { ensureSchema } from '../../src/db/migrate'
import { donations, schema } from '../../src/db/schema'
import { setFlagEnabled } from '../../src/repository'

const clock = new SystemClock()

/**
 * Provider verification for donations-service — see `runProviderVerification`. Boots with an
 * always-capture payment stub (verification is about the HTTP contract, not the payment seam, which
 * Microcks virtualizes in the cluster); state handlers seed the gating flag cache and donation rows.
 * Run via `pnpm pact:verify --provider donations` (needs Docker; not part of the unit suite).
 */
await runProviderVerification({
  provider: 'donations',
  scriptDir: import.meta.dirname,
  schema,
  ensureSchema,
  buildApp: (db) =>
    buildApp({
      db,
      clock,
      ids: new UlidIdGenerator(),
      randomness: new CryptoRandomness(),
      payment: { charge: async () => ({ provider_ref: 'pref_verify', status: 'captured' }) },
    }),
  stateHandlers: (db) => ({
    'donations are enabled for the community': async (params) => {
      const p = params as Record<string, string>
      await setFlagEnabled(db, p.community_id, 'donations', true, clock.now())
      return { description: `donations enabled for ${p.community_id}` }
    },
    'a donation exists in the community': async (params) => {
      const p = params as Record<string, string>
      const now = clock.now()
      await db
        .insert(donations)
        .values({
          id: p.id,
          communityId: p.community_id,
          donorId: 'user_01HZY0K7M3QF8VN2J5RX9TB4CG',
          amountCents: 2500,
          currency: 'USD',
          status: 'Captured',
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
      return { description: `seeded donation ${p.id}` }
    },
    'no such donation exists': async (params) => {
      const p = params as Record<string, string>
      await db.delete(donations).where(eq(donations.id, p.id))
      return { description: `ensured donation ${p.id} absent` }
    },
  }),
})

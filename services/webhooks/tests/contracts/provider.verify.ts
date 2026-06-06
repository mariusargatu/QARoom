import { CryptoRandomness, SystemClock, UlidIdGenerator } from '@qaroom/determinism'
import { runProviderVerification } from '@qaroom/testing-utils/contracts'
import { eq } from 'drizzle-orm'
import { buildApp } from '../../src/app'
import { ensureSchema } from '../../src/db/migrate'
import { schema, webhookSubscriptions } from '../../src/db/schema'

const clock = new SystemClock()

/**
 * Provider verification for webhooks-service — see `runProviderVerification`. Provider states seed
 * subscription rows directly so the gateway's replayed requests find what the consumer assumed.
 * Run via `pnpm pact:verify --provider webhooks` (needs Docker; not part of the unit suite).
 */
await runProviderVerification({
  provider: 'webhooks',
  scriptDir: import.meta.dirname,
  schema,
  ensureSchema,
  buildApp: (db) =>
    buildApp({ db, clock, ids: new UlidIdGenerator(), randomness: new CryptoRandomness() }),
  stateHandlers: (db) => ({
    'a webhook subscription exists': async (params) => {
      const p = params as Record<string, string>
      const now = clock.now()
      await db
        .insert(webhookSubscriptions)
        .values({
          id: p.subscription_id,
          communityId: p.community_id,
          url: p.url ?? 'https://hooks.example.com/qaroom',
          secret: 'whsec_verify',
          eventTypes: ['post.created'],
          status: 'Active',
          consecutiveDeadLetters: 0,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
      return { description: `seeded subscription ${p.subscription_id}` }
    },
    'no such webhook subscription exists': async (params) => {
      const p = params as Record<string, string>
      await db.delete(webhookSubscriptions).where(eq(webhookSubscriptions.id, p.subscription_id))
      return { description: `ensured subscription ${p.subscription_id} absent` }
    },
  }),
})

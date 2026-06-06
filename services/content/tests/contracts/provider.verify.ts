import { CryptoRandomness, SystemClock, UlidIdGenerator } from '@qaroom/determinism'
import { runProviderVerification } from '@qaroom/testing-utils/contracts'
import { eq } from 'drizzle-orm'
import { buildApp } from '../../src/app'
import { ensureSchema } from '../../src/db/migrate'
import { posts, schema } from '../../src/db/schema'

/**
 * Provider verification for content-service — see `runProviderVerification`. Provider states seed
 * posts directly so the gateway's replayed requests find the data the consumer assumed.
 * Run via `pnpm pact:verify --provider content` (needs Docker; not part of the unit suite).
 */
await runProviderVerification({
  provider: 'content',
  scriptDir: import.meta.dirname,
  schema,
  ensureSchema,
  buildApp: (db) =>
    buildApp({
      db,
      clock: new SystemClock(),
      ids: new UlidIdGenerator(),
      randomness: new CryptoRandomness(),
    }),
  stateHandlers: (db) => ({
    'a post exists': async (params) => {
      const p = params as Record<string, string>
      await db
        .insert(posts)
        .values({
          id: p.id,
          communityId: p.community_id,
          authorId: p.author_id,
          title: p.title ?? 'seeded title',
          body: p.body ?? 'seeded body',
          score: 0,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        })
        .onConflictDoNothing()
      return { description: `seeded post ${p.id}` }
    },
    'no such post exists': async (params) => {
      const p = params as Record<string, string>
      await db.delete(posts).where(eq(posts.id, p.id))
      return { description: `ensured post ${p.id} absent` }
    },
  }),
})

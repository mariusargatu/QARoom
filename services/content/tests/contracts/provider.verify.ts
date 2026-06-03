import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Verifier } from '@pact-foundation/pact'
import { CryptoRandomness, SystemClock, UlidIdGenerator } from '@qaroom/determinism'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { buildApp } from '../../src/app'
import { ensureSchema } from '../../src/db/migrate'
import { posts, schema } from '../../src/db/schema'

/**
 * Provider verification: boot content-service against a REAL Postgres (Testcontainers)
 * and replay every pact that names "content" as provider (monorepo-as-broker — no
 * external Pact Broker). Provider states seed the database directly so the replayed
 * requests find the data the consumer assumed.
 *
 * Run via `pnpm pact:verify --provider content` (not part of the unit suite — needs Docker).
 */
const ROOT = resolve(import.meta.dirname, '../../../..')
const pactFiles = globSync('services/*/pacts/*.json', { cwd: ROOT })
  .map((f) => resolve(ROOT, f))
  .filter((f) => JSON.parse(readFileSync(f, 'utf8')).provider?.name === 'content')

if (pactFiles.length === 0) {
  process.stdout.write('no pact files name "content" as provider — nothing to verify\n')
  process.exit(0)
}

const container = await new PostgreSqlContainer('postgres:18-alpine').start()
const sql = postgres(container.getConnectionUri(), { max: 4 })
const db = drizzle(sql, { schema })
await ensureSchema(db)

const app = buildApp({
  db,
  clock: new SystemClock(),
  ids: new UlidIdGenerator(),
  randomness: new CryptoRandomness(),
})
await app.listen({ port: 0, host: '127.0.0.1' })
const address = app.server.address()
const port = typeof address === 'object' && address !== null ? address.port : 0

let failed = false
try {
  await new Verifier({
    provider: 'content',
    providerBaseUrl: `http://127.0.0.1:${port}`,
    pactUrls: pactFiles,
    stateHandlers: {
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
    },
  }).verifyProvider()
  process.stdout.write('✓ pact provider verification passed\n')
} catch (err) {
  failed = true
  process.stderr.write(`✗ pact provider verification failed: ${String(err)}\n`)
} finally {
  await app.close()
  await sql.end()
  await container.stop()
}

process.exit(failed ? 1 : 0)

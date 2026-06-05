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
import { schema, webhookSubscriptions } from '../../src/db/schema'

/**
 * Provider verification for webhooks-service: boot it against a REAL Postgres (Testcontainers) and
 * replay every pact naming "webhooks" as provider (monorepo-as-broker). Provider states seed
 * subscription rows directly so the gateway's replayed requests find what the consumer assumed.
 *
 * Run via `pnpm pact:verify --provider webhooks` (needs Docker; not part of the unit suite).
 */
const ROOT = resolve(import.meta.dirname, '../../../..')
const pactFiles = globSync('services/*/pacts/*.json', { cwd: ROOT })
  .map((f) => resolve(ROOT, f))
  .filter((f) => JSON.parse(readFileSync(f, 'utf8')).provider?.name === 'webhooks')

if (pactFiles.length === 0) {
  process.stdout.write('no pact files name "webhooks" as provider — nothing to verify\n')
  process.exit(0)
}

const container = await new PostgreSqlContainer('postgres:18-alpine').start()
const sql = postgres(container.getConnectionUri(), { max: 4 })
const db = drizzle(sql, { schema })
await ensureSchema(db)

const clock = new SystemClock()
const app = buildApp({ db, clock, ids: new UlidIdGenerator(), randomness: new CryptoRandomness() })
await app.listen({ port: 0, host: '127.0.0.1' })
const address = app.server.address()
const port = typeof address === 'object' && address !== null ? address.port : 0

let failed = false
try {
  await new Verifier({
    provider: 'webhooks',
    providerBaseUrl: `http://127.0.0.1:${port}`,
    pactUrls: pactFiles,
    stateHandlers: {
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

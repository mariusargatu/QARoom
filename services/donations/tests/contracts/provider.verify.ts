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
import { donations, schema } from '../../src/db/schema'
import { setFlagEnabled } from '../../src/repository'

/**
 * Provider verification for donations-service: boot it against a REAL Postgres (Testcontainers)
 * with a stub payment provider that always captures, and replay every pact naming "donations"
 * as provider (monorepo-as-broker). Provider states seed the gating flag cache and donation rows
 * directly so the gateway's replayed requests find what the consumer assumed.
 *
 * Run via `pnpm pact:verify --provider donations` (needs Docker; not part of the unit suite).
 */
const ROOT = resolve(import.meta.dirname, '../../../..')
const pactFiles = globSync('services/*/pacts/*.json', { cwd: ROOT })
  .map((f) => resolve(ROOT, f))
  .filter((f) => JSON.parse(readFileSync(f, 'utf8')).provider?.name === 'donations')

if (pactFiles.length === 0) {
  process.stdout.write('no pact files name "donations" as provider — nothing to verify\n')
  process.exit(0)
}

const container = await new PostgreSqlContainer('postgres:18-alpine').start()
const sql = postgres(container.getConnectionUri(), { max: 4 })
const db = drizzle(sql, { schema })
await ensureSchema(db)

const clock = new SystemClock()
const app = buildApp({
  db,
  clock,
  ids: new UlidIdGenerator(),
  randomness: new CryptoRandomness(),
  // Always-capture payment stub: provider verification is about the donations HTTP contract,
  // not the payment provider (that seam is virtualized by Microcks in the cluster).
  payment: { charge: async () => ({ provider_ref: 'pref_verify', status: 'captured' }) },
})
await app.listen({ port: 0, host: '127.0.0.1' })
const address = app.server.address()
const port = typeof address === 'object' && address !== null ? address.port : 0

let failed = false
try {
  await new Verifier({
    provider: 'donations',
    providerBaseUrl: `http://127.0.0.1:${port}`,
    pactUrls: pactFiles,
    stateHandlers: {
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

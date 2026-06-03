import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Verifier } from '@pact-foundation/pact'
import { CryptoRandomness, SystemClock, UlidIdGenerator } from '@qaroom/determinism'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { buildApp } from '../../src/app'
import { runIdentityMigration } from '../../src/db/migrate'
import { schema, signingKeys } from '../../src/db/schema'
import { ProductionKeyMaterialSource } from '../../src/keys'
import { TEST_PRIVATE_JWK, TEST_PUBLIC_JWK } from '../fixtures/test-key-material'

/**
 * Provider verification: boot identity-service against a REAL Postgres (Testcontainers)
 * and replay every pact naming "identity" as provider (monorepo-as-broker). The
 * 'a signing key exists' state handler seeds the deterministic fixture key under the kid
 * the consumer expects, so GET /jwks.json returns it.
 *
 * Run via `pnpm pact:verify --provider identity` (needs Docker; not part of the unit suite).
 */
const ROOT = resolve(import.meta.dirname, '../../../..')
const pactFiles = globSync('services/*/pacts/*.json', { cwd: ROOT })
  .map((f) => resolve(ROOT, f))
  .filter((f) => JSON.parse(readFileSync(f, 'utf8')).provider?.name === 'identity')

if (pactFiles.length === 0) {
  process.stdout.write('no pact files name "identity" as provider — nothing to verify\n')
  process.exit(0)
}

const container = await new PostgreSqlContainer('postgres:18-alpine').start()
const sql = postgres(container.getConnectionUri(), { max: 4 })
const db = drizzle(sql, { schema })
await runIdentityMigration(db, { clock: new SystemClock() })

const app = buildApp({
  db,
  clock: new SystemClock(),
  ids: new UlidIdGenerator(),
  randomness: new CryptoRandomness(),
  keyMaterial: new ProductionKeyMaterialSource(),
})
await app.listen({ port: 0, host: '127.0.0.1' })
const address = app.server.address()
const port = typeof address === 'object' && address !== null ? address.port : 0

let failed = false
try {
  await new Verifier({
    provider: 'identity',
    providerBaseUrl: `http://127.0.0.1:${port}`,
    pactUrls: pactFiles,
    stateHandlers: {
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

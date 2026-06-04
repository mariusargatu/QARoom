import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Verifier } from '@pact-foundation/pact'
import { CryptoRandomness, SystemClock, UlidIdGenerator } from '@qaroom/determinism'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { buildApp } from '../../src/app'
import { ensureSchema } from '../../src/db/migrate'
import { schema } from '../../src/db/schema'

/**
 * Provider verification for flags-service: boot it against a REAL Postgres (Testcontainers)
 * and replay every pact naming "flags" as provider (monorepo-as-broker). No state handlers are
 * needed — an unknown flag resolves to the rollout's initial `Off`, and `EnableRequested` is a
 * legal transition from `Off`, so the gateway's replayed requests succeed against a fresh DB.
 *
 * Run via `pnpm pact:verify --provider flags` (needs Docker; not part of the unit suite).
 */
const ROOT = resolve(import.meta.dirname, '../../../..')
const pactFiles = globSync('services/*/pacts/*.json', { cwd: ROOT })
  .map((f) => resolve(ROOT, f))
  .filter((f) => JSON.parse(readFileSync(f, 'utf8')).provider?.name === 'flags')

if (pactFiles.length === 0) {
  process.stdout.write('no pact files name "flags" as provider — nothing to verify\n')
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
  // A no-op transition sink: the xstate.transition span emission is covered by @qaroom/otel;
  // provider verification only asserts the flags HTTP contract.
  transitionSink: { record: () => {} },
})
await app.listen({ port: 0, host: '127.0.0.1' })
const address = app.server.address()
const port = typeof address === 'object' && address !== null ? address.port : 0

let failed = false
try {
  await new Verifier({
    provider: 'flags',
    providerBaseUrl: `http://127.0.0.1:${port}`,
    pactUrls: pactFiles,
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

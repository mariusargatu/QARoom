import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Verifier } from '@pact-foundation/pact'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { FastifyInstance } from 'fastify'
import postgres from 'postgres'

type StateHandlers = Record<string, (params: unknown) => Promise<{ description: string }>>

export interface ProviderVerificationOptions<Schema extends Record<string, unknown>> {
  /** Provider name as it appears in each pact's `provider.name`. */
  provider: string
  /** The calling script's `import.meta.dirname` — used to locate the repo root and its pact files. */
  scriptDir: string
  /** Drizzle schema object, passed to `drizzle(sql, { schema })`. */
  schema: Schema
  /** Apply the service's full schema (domain + messaging) to the fresh verification database. */
  ensureSchema(db: PostgresJsDatabase<Schema>): Promise<void>
  /** Wire and return the service's Fastify app against the verification database. */
  buildApp(db: PostgresJsDatabase<Schema>): FastifyInstance
  /** Optional provider-state seeders, built against the database (omit when none are needed). */
  stateHandlers?(db: PostgresJsDatabase<Schema>): StateHandlers
}

/**
 * Shared scaffold for every `services/<svc>/tests/contracts/provider.verify.ts`: boot the provider
 * against a REAL Postgres (Testcontainers) and replay every pact that names it as provider
 * (monorepo-as-broker — no external Pact Broker). The service supplies only its schema, app wiring,
 * and provider-state seeders. Run via `pnpm pact:verify --provider <svc>` (needs Docker; not part of
 * the unit suite). Owns the script lifecycle: it calls `process.exit(0|1)` and never returns normally.
 */
export async function runProviderVerification<Schema extends Record<string, unknown>>(
  opts: ProviderVerificationOptions<Schema>,
): Promise<void> {
  const root = resolve(opts.scriptDir, '../../../..')
  const pactFiles = globSync('services/*/pacts/*.json', { cwd: root })
    .map((f) => resolve(root, f))
    .filter((f) => JSON.parse(readFileSync(f, 'utf8')).provider?.name === opts.provider)

  if (pactFiles.length === 0) {
    process.stdout.write(`no pact files name "${opts.provider}" as provider — nothing to verify\n`)
    process.exit(0)
  }

  const container = await new PostgreSqlContainer('postgres:18-alpine').start()
  const sql = postgres(container.getConnectionUri(), { max: 4 })
  const db = drizzle(sql, { schema: opts.schema })
  await opts.ensureSchema(db)

  const app = opts.buildApp(db)
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0

  // ponytail: hard wall-clock so a wedged verifier (pact-core FFI has been seen to stall the
  // in-process event loop, where its own per-request timeout can't fire) fails the lane in minutes
  // instead of hanging CI for hours. Override with PACT_VERIFY_TIMEOUT_MS if a fleet ever needs more.
  const timeoutMs = Number(process.env.PACT_VERIFY_TIMEOUT_MS) || 120_000
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`pact verification exceeded ${timeoutMs}ms — verifier wedged`)),
      timeoutMs,
    )
    timer.unref()
  })

  let failed = false
  try {
    await Promise.race([
      new Verifier({
        provider: opts.provider,
        providerBaseUrl: `http://127.0.0.1:${port}`,
        pactUrls: pactFiles,
        ...(opts.stateHandlers ? { stateHandlers: opts.stateHandlers(db) } : {}),
      }).verifyProvider(),
      timeout,
    ])
    process.stdout.write('✓ pact provider verification passed\n')
  } catch (err) {
    failed = true
    process.stderr.write(`✗ pact provider verification failed: ${String(err)}\n`)
  } finally {
    clearTimeout(timer)
    await app.close()
    await sql.end()
    await container.stop()
  }

  process.exit(failed ? 1 : 0)
}

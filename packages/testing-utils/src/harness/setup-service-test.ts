import { PGlite } from '@electric-sql/pglite'
import type { SQL } from 'drizzle-orm'
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite'
import type { FakeClock } from '../determinism/fake-clock'
import type { SeededIdGenerator } from '../determinism/seeded-id-generator'
import type { SeededRandomness } from '../determinism/seeded-randomness'
import { createSeededDeps, type SeedConfig } from './seeded-deps'

export type { SeedConfig }

/**
 * Canonical per-test harness. Each call provisions a FRESH pglite database with
 * a seeded clock, deterministic ids, and seeded randomness — full per-test
 * isolation, no shared mutable state. The service supplies its own migrations
 * and app factory so this stays free of any service dependency (Commitment 16).
 */
export type HarnessDb = PgliteDatabase<Record<string, never>>

export interface TestDeps {
  db: HarnessDb
  clock: FakeClock
  ids: SeededIdGenerator
  randomness: SeededRandomness
}

export interface MigrationTarget {
  execute(query: SQL): Promise<unknown>
}

export interface Closable {
  close(): Promise<void>
}

export interface SetupOptions<App extends Closable> {
  applyMigrations(db: MigrationTarget): Promise<void>
  createApp(deps: TestDeps): App
  seed?: SeedConfig
}

export interface ServiceTest<App extends Closable> extends TestDeps {
  app: App
  pglite: PGlite
  close(): Promise<void>
}

export async function setupServiceTest<App extends Closable>(
  opts: SetupOptions<App>,
): Promise<ServiceTest<App>> {
  const pglite = new PGlite()
  const db = drizzle(pglite)
  const { clock, ids, randomness } = createSeededDeps(opts.seed)

  await opts.applyMigrations(db)
  const deps: TestDeps = { db, clock, ids, randomness }
  const app = opts.createApp(deps)

  return {
    ...deps,
    app,
    pglite,
    async close() {
      await app.close()
      await pglite.close()
    },
  }
}

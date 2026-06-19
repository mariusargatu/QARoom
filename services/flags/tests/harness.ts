import {
  EXAMPLE_COMMUNITY_ID,
  EXAMPLE_USER_ID,
  type RolloutTransitionRecord,
} from '@qaroom/contracts'
import type { SeedConfig } from '@qaroom/testing-utils/harness'
import {
  asServiceDb,
  injectClient,
  nextIdempotencyKey,
  setupServiceTest,
} from '@qaroom/testing-utils/harness'
import { buildApp } from '../src/app'
import type { FlagsDb } from '../src/db/client'
import { ensureSchema } from '../src/db/migrate'

/**
 * Per-test flags-service harness: fresh pglite + seeded determinism + a wired app, plus the
 * shared inject request client. A RECORDING transition sink is injected (instead of the
 * production OTel span emitter) so tests can assert each `xstate.transition` deterministically
 * via `ctx.transitions` — the span emission itself is covered by `@qaroom/otel`.
 */
export async function setupFlagsTest(seed?: SeedConfig) {
  const transitions: RolloutTransitionRecord[] = []
  const ctx = await setupServiceTest({
    applyMigrations: (db) => ensureSchema(db),
    createApp: (deps) =>
      buildApp({
        db: asServiceDb<FlagsDb>(deps.db),
        clock: deps.clock,
        ids: deps.ids,
        randomness: deps.randomness,
        transitionSink: { record: (t) => transitions.push(t) },
      }),
    seed,
  })
  return { ...ctx, request: injectClient(ctx.app), transitions }
}

export type FlagsTestCtx = Awaited<ReturnType<typeof setupFlagsTest>>

/**
 * Run `fn` against a fresh flags app with guaranteed teardown. Owns the try/finally the
 * `no-conditional-in-test` rule (rightly) keeps out of spec bodies — without it, every failing
 * fast-check run AND every shrink iteration would leak a live pglite instance.
 */
export async function withFlagsCtx<T>(fn: (ctx: FlagsTestCtx) => Promise<T>): Promise<T> {
  const ctx = await setupFlagsTest()
  try {
    return await fn(ctx)
  } finally {
    await ctx.close()
  }
}

/** Valid example identifiers for tests (communityB differs from A for isolation tests). */
export const SAMPLE = {
  communityA: EXAMPLE_COMMUNITY_ID,
  communityB: 'comm_01HZY0K7M3QF8VN2J5RX9TB4CE',
  user: EXAMPLE_USER_ID,
  flag: 'donations',
} as const

/** A unique Idempotency-Key per mutation in a test (deterministic, not crypto). */
export const nextKey = () => nextIdempotencyKey('flags')

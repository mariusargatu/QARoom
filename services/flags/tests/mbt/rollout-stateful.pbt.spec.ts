import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rolloutMachine } from '@qaroom/contracts'
import { allEdges, coverageReport, edgeRecorder } from '@qaroom/testing-utils/mbt'
import fc from 'fast-check'
import { afterAll, describe, expect, it } from 'vitest'
import { nextKey, withFlagsCtx } from '../harness'
import { ROLLOUT_URL, type RolloutModel, rolloutCommandArbitraries } from './commands'

/**
 * Phase 1 — bug-finding: random command SEQUENCES against the live flags-service (the repo's
 * first stateful property test). fast-check generates sequences of rollout events, the command
 * layer asserts the dual oracle (legal → 200 + echoed state; illegal → 409 + state untouched)
 * after every step, and a failing sequence shrinks to the minimal counterexample.
 *
 * Replay recipe (an `fc.commands` failure needs THREE values, not just the seed — the
 * executed-vs-skipped history lives in `replayPath`): re-run with `VITEST_SEED=<seed>` and pass
 * `{ replayPath: '<replayPath>' }` to `fc.commands` plus `{ seed, path }` to `fc.assert`.
 *
 * Budget: numRuns 15 × ≤10 commands, one fresh pglite per sequence (~0.4 s warm) ≈ 6–8 s local;
 * the 120 s per-test timeout leaves room for shrinking (each shrink iteration boots a pglite)
 * so a mid-shrink Vitest kill can't truncate the minimal counterexample.
 */

const recorder = edgeRecorder()

const ARTIFACT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../test-results/mbt-edge-coverage-pbt.json',
)

// Edge coverage of the random walk is REPORTED (execution evidence for the results fold), never
// asserted — randomness owes no coverage guarantee; the deterministic gap-fill spec owns 7/7.
afterAll(() => {
  const report = coverageReport(allEdges(rolloutMachine), recorder.covered())
  mkdirSync(dirname(ARTIFACT), { recursive: true })
  writeFileSync(ARTIFACT, `${JSON.stringify({ runner: 'pbt-walk', ...report }, null, 2)}\n`)
})

describe('stateful PBT over the rollout machine', () => {
  it('every random event sequence conforms: legal events advance as modeled, illegal events 409 and change nothing', {
    timeout: 120_000,
  }, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.commands(rolloutCommandArbitraries(), { maxCommands: 10 }),
        async (cmds) => {
          await withFlagsCtx(async (ctx) => {
            await fc.asyncModelRun(
              () => ({
                model: { state: 'Off' } as RolloutModel,
                real: { request: ctx.request, recordEdge: recorder.record },
              }),
              cmds,
            )
          })
        },
      ),
      { numRuns: 15 },
    )
  })

  it('an illegal-event 409 is never stored for its idempotency key — the key replays as a real execution once legal', async () => {
    await withFlagsCtx(async (ctx) => {
      const key = nextKey()
      // CanaryConfirmed is illegal from Off: 409, and (unlike a 200) nothing is stored.
      const illegal = await ctx.request.post(
        ROLLOUT_URL,
        { event: 'CanaryConfirmed' },
        { 'idempotency-key': key },
      )
      expect(illegal.status).toBe(409)

      const enable = await ctx.request.post(
        ROLLOUT_URL,
        { event: 'EnableRequested' },
        { 'idempotency-key': nextKey() },
      )
      expect(enable.status).toBe(200)

      // Same key, same body, now legal: it EXECUTES a real transition instead of replaying a
      // stored response — proof the earlier 409 never reached the idempotency store.
      const reused = await ctx.request.post(
        ROLLOUT_URL,
        { event: 'CanaryConfirmed' },
        { 'idempotency-key': key },
      )
      expect(reused.status).toBe(200)
      expect((reused.json as { state?: string }).state).toBe('Canary')
    })
  })
})

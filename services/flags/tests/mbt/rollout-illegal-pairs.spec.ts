import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rolloutMachine } from '@qaroom/contracts'
import {
  type GeneratedStep,
  illegalPairs,
  modeledStates,
  PR_MAX_DEPTH,
  shortestPaths,
} from '@qaroom/testing-utils/mbt'
import { afterAll, describe, expect, it } from 'vitest'
import { nextKey, withFlagsCtx } from '../harness'
import { FLAG_URL, ROLLOUT_URL } from './commands'

/**
 * All-illegal-pairs tour — the negative complement of the all-transitions spec. The rollout
 * machine declares 7 legal edges out of 5 states × 6 events = 30 combinations; the other 23
 * pairs are each owed a 409 `rollout-transition-illegal` AND an unchanged state. Together with
 * 7/7 edge coverage this exercises the COMPLETE transition function, single-fault: every cell
 * of the state × event table is asserted, positively or negatively. Grouped by state (one
 * fresh service per state, not per pair): an illegal event provably leaves the state untouched,
 * so all of a state's illegal events are probed sequentially against one context.
 */

const PATHS = shortestPaths(rolloutMachine, { maxDepth: PR_MAX_DEPTH })
const PAIRS = illegalPairs(rolloutMachine)
const STATES = modeledStates(rolloutMachine)

function routeTo(state: string): GeneratedStep[] {
  const path = PATHS.find((p) => p.target === JSON.stringify(state))
  return (path ?? { steps: [] }).steps
}

const probed = new Set<string>()

const ARTIFACT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../test-results/mbt-illegal-pairs.json',
)

afterAll(() => {
  mkdirSync(dirname(ARTIFACT), { recursive: true })
  writeFileSync(
    ARTIFACT,
    `${JSON.stringify(
      {
        runner: 'mbt-illegal-pairs',
        pairs_total: PAIRS.length,
        pairs_probed: probed.size,
        gap: PAIRS.map((p) => `${p.state}|${p.event}`).filter((k) => !probed.has(k)),
      },
      null,
      2,
    )}\n`,
  )
})

describe('all-illegal-pairs conformance of the rollout machine', () => {
  it('the machine declares 7 of 30 combinations legal — 23 illegal pairs to probe', () => {
    expect(PAIRS).toHaveLength(23)
  })

  it.each(
    STATES.map((state) => ({
      state,
      events: PAIRS.filter((p) => p.state === state).map((p) => p.event),
    })),
  )('every illegal event from $state is rejected and changes nothing', async ({
    state,
    events,
  }) => {
    await withFlagsCtx(async (ctx) => {
      for (const step of routeTo(state)) {
        const res = await ctx.request.post(
          ROLLOUT_URL,
          { event: step.event },
          { 'idempotency-key': nextKey() },
        )
        expect(res.status).toBe(200)
      }
      for (const event of events) {
        const res = await ctx.request.post(ROLLOUT_URL, { event }, { 'idempotency-key': nextKey() })
        expect(res.status, `${event} from ${state} must be rejected`).toBe(409)
        expect((res.json as { type?: string }).type).toBe(
          'https://qaroom.dev/errors/rollout-transition-illegal',
        )
        const after = await ctx.request.get(FLAG_URL)
        expect((after.json as { state?: string }).state, `${event} must not move ${state}`).toBe(
          state,
        )
        probed.add(`${state}|${event}`)
      }
    })
  })

  it('all 23 illegal pairs were probed', () => {
    expect(probed.size).toBe(PAIRS.length)
  })
})

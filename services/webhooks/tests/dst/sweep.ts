import { withResource } from '@qaroom/testing-utils/harness'
import { runSimulation } from './drive'
import { assertDeliveryInvariants } from './invariants'
import { type Coverage, emptyCoverage, type History, mergeCoverage } from './types'
import { setupSimWorld } from './world'

/**
 * The sweep + replay entry points. The loop and the throw-on-violation live here (a plain module),
 * NOT in the `*.spec.ts` body, so the test file stays free of control flow and each assertion is a
 * single `expect`. A red seed propagates as a thrown error carrying `seed + commit` (the replay
 * contract), failing the test with the exact coordinates to reproduce it.
 */

/** Run one seed end-to-end and assert every delivery invariant. Returns its coverage tally. */
export async function runOneSeed(seed: number): Promise<Coverage> {
  return withResource(
    () => setupSimWorld(seed),
    async (world) => {
      const history = await runSimulation(world)
      assertDeliveryInvariants(history, world)
      return history.coverage
    },
  )
}

/** Fold a list of seeds, asserting invariants on each and summing coverage across the sweep. */
export async function runSweep(seeds: number[]): Promise<Coverage> {
  let total = emptyCoverage()
  for (const seed of seeds) {
    total = mergeCoverage(total, await runOneSeed(seed))
  }
  return total
}

/** `count` consecutive seeds from `start` — the workload the sweep explores. */
export function seedList(count: number, start = 1): number[] {
  return Array.from({ length: count }, (_, i) => start + i)
}

/**
 * A `runTwiceAndDiff` build step: a fresh world for `seed`, whose `act` runs the simulation and
 * returns its `History`. The meta-test fingerprints two such runs and proves them byte-identical —
 * the determinism guarantee the whole DST slice rests on. No invariant is asserted here; this
 * checks REPRODUCIBILITY, not correctness.
 */
export function buildSimRun(
  seed: number,
): () => Promise<{ act: () => Promise<History>; close: () => Promise<void> }> {
  return async () => {
    const world = await setupSimWorld(seed)
    return { act: () => runSimulation(world), close: world.close }
  }
}

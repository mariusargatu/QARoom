import { withResource } from '@qaroom/testing-utils/harness'
import type { InMemoryBrokerFaults } from '@qaroom/testing-utils/scenario'
import { type Coverage, emptyCoverage, mergeCoverage } from '../types'
import { runComposed } from './drive'
import { assertComposedInvariants } from './invariants'
import {
  type ComposedHistory,
  type CrossCoverage,
  emptyCrossCoverage,
  mergeCrossCoverage,
} from './types'
import { setupComposedWorld } from './world'

/**
 * The composed sweep + replay entry points. The fold and the throw-on-violation live here (a plain
 * module), NOT in the `*.spec.ts` body, so the test file stays free of control flow and each assertion
 * is a single `expect`. A red seed propagates as a thrown error carrying `seed + commit`.
 */

/** Both coverage tallies a composed run produces: webhooks send/terminal + the cross-boundary tally. */
export interface ComposedCoverage {
  receiver: Coverage
  cross: CrossCoverage
}

/** Run one seed end-to-end and assert every cross-service invariant. `faults` arms the planted bug. */
export async function runOneSeed(
  seed: number,
  faults?: InMemoryBrokerFaults,
): Promise<ComposedCoverage> {
  return withResource(
    () => setupComposedWorld(seed, { brokerFaults: faults }),
    async (world) => {
      const history = await runComposed(world)
      assertComposedInvariants(history, world)
      return { receiver: history.receiverCoverage, cross: history.cross }
    },
  )
}

/** Fold a list of seeds, asserting invariants on each and summing both coverage tallies. */
export async function runSweep(seeds: number[]): Promise<ComposedCoverage> {
  let receiver = emptyCoverage()
  let cross = emptyCrossCoverage()
  for (const seed of seeds) {
    const cov = await runOneSeed(seed)
    receiver = mergeCoverage(receiver, cov.receiver)
    cross = mergeCrossCoverage(cross, cov.cross)
  }
  return { receiver, cross }
}

/** `count` consecutive seeds from `start` — the workload the sweep explores. */
export function seedList(count: number, start = 1): number[] {
  return Array.from({ length: count }, (_, i) => start + i)
}

/**
 * A `runTwiceAndDiff` build step: a fresh composed world for `seed`, whose `act` runs the simulation
 * and returns its `ComposedHistory`. The meta-test fingerprints two such runs and proves them
 * byte-identical — determinism surviving the service boundary. No invariant is asserted here; this
 * checks REPRODUCIBILITY, not correctness.
 */
export function buildComposedRun(
  seed: number,
): () => Promise<{ act: () => Promise<ComposedHistory>; close: () => Promise<void> }> {
  return async () => {
    const world = await setupComposedWorld(seed)
    return { act: () => runComposed(world), close: world.close }
  }
}

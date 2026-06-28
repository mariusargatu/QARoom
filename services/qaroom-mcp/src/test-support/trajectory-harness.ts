import { createSeededDeps } from '@qaroom/testing-utils/harness'
import { CONVENTIONS_TOOL_NAME } from '../registry/tools'
import type { ToolTransition } from '../trajectory/model'
import { McpSession } from '../trajectory/session'
import { type HarnessOptions, setupMcpInMemory } from './harness'

/**
 * A seeded driver that exercises the REAL `McpCore` as an agent tool-use SESSION and returns the
 * recorded trajectory — the TypeScript mirror of `dst_driver.run_trajectory` (seeded, deterministic,
 * replayable). One seed deterministically drives the discovery + read sequence over the live tool
 * catalogue, so the same seed replays an identical trajectory (the replay guarantee). The off-graph
 * falsifier is injected by the SESSION (which reads `AGENT_OFF_GRAPH_TOOL_CALL`), not by this harness —
 * the harness only seeds the legal walk, so `pnpm prove agent-trajectory-on-model --break` arms the bug
 * without this file branching on the toggle.
 *
 * Full seed-fuzzing of the whole tool surface (the moderator's fault-kind battery) is a NAMED extension
 * (see the PR body): a healthy read-first surface has no dependency-failure trajectory to fuzz, so the
 * lightweight seeded walk + the off-graph falsifier are the teeth that earn their place now.
 */
export interface TrajectoryOptions extends HarnessOptions {
  seed?: number
  steps?: number
}

export async function runMcpTrajectory(
  options: TrajectoryOptions = {},
): Promise<readonly ToolTransition[]> {
  const seed = options.seed ?? 1
  const { clock, randomness } = createSeededDeps({ randomness: seed })
  const { core } = setupMcpInMemory(options)
  const session = new McpSession({ core, clock, sessionId: `mcpsession_${seed}` })

  // The fault seam (reads AGENT_OFF_GRAPH_TOOL_CALL): a no-op unless the off-graph toggle is armed.
  session.maybeInjectOffGraphToolCall()

  // The honest read-first walk: discover the catalogue first (the graph requires it), then a seeded
  // number of real tool invocations through the live core — a community-feed read (a real proxy GET,
  // served by the fixture) interleaved with conventions self-checks (the keyless in-process oracle).
  session.discover()
  const steps = options.steps ?? 3 + randomness.int(0, 3)
  for (let step = 0; step < steps; step += 1) {
    if (randomness.int(0, 1) === 0) {
      await session.invoke('content_listCommunityFeed', { communityId: 'comm_fixture' })
    } else {
      await session.invoke(CONVENTIONS_TOOL_NAME, { code: `const reviewed${step} = ${step}` })
    }
  }
  return session.transitions
}

import {
  type InMemoryTelemetry,
  startInMemoryTelemetry,
  XSTATE_TRANSITION_SPAN,
} from '@qaroom/otel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMcpTrajectory } from '../test-support/trajectory-harness'
import { checkTrajectory, isLegal, MACHINE, OFF_GRAPH_TRANSITION } from './model'
import { AGENT_ID_ATTR, SESSION_ID_ATTR } from './span'

/**
 * The gate for the `agent-trajectory-on-model` claim (Boundary 16, ADR-0032) — the qaroom-mcp analog of
 * the moderator trajectory-DST (T21). The guarantee: an agent's tool-use trajectory over the real MCP
 * surface stays on the allowed graph (discovery before invocation) and every step carries
 * `agent.id` / `session.id`. Under `AGENT_OFF_GRAPH_TOOL_CALL` the session fires a read before the
 * catalogue is discovered, `checkTrajectory` returns a violation, and this test goes RED
 * (`pnpm prove agent-trajectory-on-model --break`). There is no branch on the toggle here: the env read
 * lives entirely in the SUT (`McpSession.maybeInjectOffGraphToolCall`), so the test is unconditional.
 */
describe('qaroom-mcp tool-use: reverse-conformance against the allowed graph', () => {
  it('every tool-use transition stays on the allowed graph and carries agent.id / session.id', async () => {
    const transitions = await runMcpTrajectory({ seed: 7 })
    // Sanity: the seeded walk actually exercised the surface, so a clean result is real, not vacuous.
    expect(transitions.length).toBeGreaterThan(1)
    // The gate: the whole trajectory is on-graph and fully identified. Arm the toggle and the injected
    // off-graph read makes this non-empty.
    expect(checkTrajectory(transitions)).toEqual([])
  })

  it('replays an identical trajectory under the same seed', async () => {
    const first = await runMcpTrajectory({ seed: 11 })
    const second = await runMcpTrajectory({ seed: 11 })
    expect(second).toEqual(first)
  })
})

describe('qaroom-mcp tool-use: every transition span carries agent + session identity', () => {
  let telemetry: InMemoryTelemetry

  beforeEach(() => {
    telemetry = startInMemoryTelemetry()
  })
  afterEach(async () => {
    await telemetry.shutdown()
  })

  it('emits one xstate.transition span per tool-use step with agent.id and session.id', async () => {
    const transitions = await runMcpTrajectory({ seed: 3 })
    const spans = telemetry.exporter.getFinishedSpans()
    expect(spans).toHaveLength(transitions.length)
    expect(spans[0]?.name).toBe(XSTATE_TRANSITION_SPAN)
    expect(spans.every((span) => span.attributes[AGENT_ID_ATTR] === MACHINE)).toBe(true)
    expect(spans.every((span) => span.attributes[SESSION_ID_ATTR] === 'mcpsession_3')).toBe(true)
  })
})

describe('qaroom-mcp trajectory model: discovery before invocation', () => {
  it('declares discover-before-invoke legal and the off-graph read illegal', () => {
    expect(isLegal('Start', 'Discover', 'Discovered')).toBe(true)
    expect(isLegal('Discovered', 'InvokeRead', 'Invoked')).toBe(true)
    expect(
      isLegal(OFF_GRAPH_TRANSITION.from, OFF_GRAPH_TRANSITION.event, OFF_GRAPH_TRANSITION.to),
    ).toBe(false)
  })
})

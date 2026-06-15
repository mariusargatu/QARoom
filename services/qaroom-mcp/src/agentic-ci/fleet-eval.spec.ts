import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { setupMcpInMemory } from '../test-support/harness'

/**
 * Fleet-eval: a DETERMINISTIC, keyless gate over the agentic-CI demonstration's goals
 * (docs/agentic-ci/goals.json), driven through the same in-process McpCore the four typed gates use.
 *
 * The demo itself (10 Claude Code subagents) is user-triggered and billed — its definition of done is a
 * frozen summary.json, not a CI pass. What was never gated is the SUBSTRATE the demo depends on: that
 * every goal maps to a tool/resource that actually EXISTS and RETURNS A STRUCTURED OUTCOME on the
 * tested surface. A renamed or removed tool would otherwise break the fleet at run time (billed) instead
 * of at CI time (free). This spec closes that — the in-repo, vendor-neutral alternative to a hosted
 * agent-eval SaaS: the agent reasoning is out of scope (that is the Milestone 9 eval story), the
 * substrate the agents drive is in scope.
 */

interface Goal {
  id: string
  summary: string
  tools: string[]
  resources: string[]
  done_when: string
}

const GOALS_PATH = fileURLToPath(new URL('../../../../docs/agentic-ci/goals.json', import.meta.url))
const goals: Goal[] = JSON.parse(readFileSync(GOALS_PATH, 'utf8')).goals as Goal[]

const COMMUNITY = `comm_${'0'.repeat(26)}`

describe('the agentic-CI goal manifest is grounded in the tested tool surface', () => {
  it('names only tools and resources that exist on the MCP surface (drift gate)', async () => {
    const { client } = setupMcpInMemory()
    const toolNames = new Set((await client.listTools()).map((tool) => tool.name))
    const resourceUris = new Set((await client.listResources()).map((resource) => resource.uri))

    // Array methods (no `if`/branching) keep this within the no-conditional-in-test rule.
    const missing = goals.flatMap((goal) => [
      ...goal.tools
        .filter((tool) => !toolNames.has(tool))
        .map((tool) => `${goal.id} -> missing tool ${tool}`),
      ...goal.resources
        .filter((resource) => !resourceUris.has(resource))
        .map((resource) => `${goal.id} -> missing resource ${resource}`),
    ])
    expect(missing).toEqual([])
  })

  it('covers at least one goal (the manifest is non-empty)', () => {
    expect(goals.length).toBeGreaterThan(0)
  })
})

describe('the read-only fleet goals execute against the tested substrate', () => {
  it('results-oracle: reads the summary resource (to enumerate failed runners)', async () => {
    const { client } = setupMcpInMemory()
    const outcome = await client.readResource('qaroom://test-results/summary')
    expect(outcome.ok).toBe(true)
  })

  it('limits-watch: reads gateway rate-limit usage (to drive a back-off decision)', async () => {
    const { client } = setupMcpInMemory()
    const outcome = await client.readResource('qaroom://gateway/system/limits')
    expect(outcome.ok).toBe(true)
  })

  it('feed-survey: lists a community feed and reads gateway state', async () => {
    const { client } = setupMcpInMemory()
    const feed = await client.callTool('content_listCommunityFeed', { communityId: COMMUNITY })
    expect(feed.ok).toBe(true)
    const state = await client.readResource('qaroom://gateway/system/state')
    expect(state.ok).toBe(true)
  })

  it('convention-selfcheck: the oracle returns ok for a clean snippet', async () => {
    const { client } = setupMcpInMemory()
    const outcome = await client.callTool('qaroom_conventionsCheck', {
      code: 'export const value = 1',
    })
    expect(outcome.ok).toBe(true)
  })

  it('every goal tool returns a STRUCTURED outcome (never throws), even unrouted ones', async () => {
    // flag-audit / donation-readonly tools are not routed by the in-memory fixture, so their calls
    // resolve to a structured RFC 7807 tool error rather than a success — but they must still return a
    // typed outcome, never throw. That structured-failure contract is the substrate guarantee that lets
    // a fleet recover predictably (the closed FailureDomain enum). Logged, not silently skipped.
    const { client } = setupMcpInMemory()
    const refs = goals.flatMap((goal) =>
      goal.tools.map((tool) => ({ key: `${goal.id}:${tool}`, tool })),
    )
    const outcomes = await Promise.all(
      refs.map(async ({ key, tool }) => ({
        key,
        ok: (await client.callTool(tool, { communityId: COMMUNITY })).ok,
      })),
    )
    // Every call returned a typed outcome (none threw) — the substrate guarantee.
    expect(outcomes.every((o) => typeof o.ok === 'boolean')).toBe(true)
    // No silent caps: report which goal-tools ran green vs returned a structured error on the fixture.
    const okList = outcomes.filter((o) => o.ok).map((o) => o.key)
    const errList = outcomes.filter((o) => !o.ok).map((o) => o.key)
    console.info(
      `[fleet-eval] tools ok on fixture: ${okList.join(', ')} | structured-error: ${errList.join(', ')}`,
    )
  })
})

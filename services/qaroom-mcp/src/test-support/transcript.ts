import type { McpClient } from '../transport/client'

/**
 * A fixed call sequence over the in-memory transport. Under the seeded determinism trio
 * the request ids and served_at timestamps are stable, so the serialized transcript is
 * byte-identical run to run (Gate 3) — the discipline only holds *because* time and ids
 * are injected.
 */
const VALID_COMMUNITY = `comm_${'0'.repeat(26)}`
const VALID_POST = `post_${'0'.repeat(26)}`

export async function runGoldenTranscript(client: McpClient): Promise<unknown[]> {
  const steps: unknown[] = []
  steps.push({ step: 'listTools', tools: (await client.listTools()).map((tool) => tool.name) })
  steps.push({
    step: 'callTool:content_getPost',
    outcome: await client.callTool('content_getPost', { postId: VALID_POST }),
  })
  steps.push({
    step: 'callTool:gateway_listCommunityFeed',
    outcome: await client.callTool('gateway_listCommunityFeed', { communityId: VALID_COMMUNITY }),
  })
  steps.push({ step: 'callTool:unknown', outcome: await client.callTool('nope', {}) })
  steps.push({
    step: 'callTool:conventions',
    outcome: await client.callTool('qaroom_conventionsCheck', {
      code: 'export const stamp = () => new Date()',
    }),
  })
  steps.push({
    step: 'readResource:gateway-state',
    outcome: await client.readResource('qaroom://gateway/system/state'),
  })
  steps.push({
    step: 'readResource:test-results',
    outcome: await client.readResource('qaroom://test-results/summary'),
  })
  return steps
}

export function serializeTranscript(steps: unknown[]): string {
  return `${JSON.stringify(steps, null, 2)}\n`
}

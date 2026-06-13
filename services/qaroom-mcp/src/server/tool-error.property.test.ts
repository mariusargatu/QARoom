import { makeProblem } from '@qaroom/contracts'
import { expectRFC7807 } from '@qaroom/testing-utils/matchers'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { fixtureServiceClient, problemResponse } from '../client/fixture-service-client'
import { setupMcpInMemory } from '../test-support/harness'

const VALID_POST_ID = `post_${'0'.repeat(26)}`

function problemOf(outcome: { ok: boolean } & Record<string, unknown>): unknown {
  return outcome.problem
}

describe('MCP tool errors as RFC 7807 Problem Details', () => {
  it('returns a not_found problem for any unknown tool name', async () => {
    const { client } = setupMcpInMemory()
    await fc.assert(
      fc.asyncProperty(fc.string(), async (suffix) => {
        const outcome = await client.callTool(`unknown_${suffix}`, {})
        expect(outcome.ok).toBe(false)
        const problem = expectRFC7807(problemOf(outcome), { failureDomain: 'not_found' })
        expect(problem.status).toBe(404)
      }),
    )
  })

  it('returns a validation problem for a malformed branded id', async () => {
    const { client } = setupMcpInMemory()
    await fc.assert(
      fc.asyncProperty(fc.string(), async (junk) => {
        const outcome = await client.callTool('content_getPost', { postId: `bad-${junk}` })
        expect(outcome.ok).toBe(false)
        const problem = expectRFC7807(problemOf(outcome), { failureDomain: 'validation' })
        expect(problem.status).toBe(400)
      }),
    )
  })

  it('passes an upstream RFC 7807 dependency failure through unchanged', async () => {
    const upstream = makeProblem({
      slug: 'content-unreachable',
      title: 'Upstream content-service unavailable',
      status: 502,
      failure_domain: 'dependency_failure',
      retryable: true,
    })
    const services = fixtureServiceClient([
      {
        service: 'content',
        path: /^\/api\/posts\/[^/]+$/,
        response: problemResponse(502, upstream),
      },
    ])
    const { client } = setupMcpInMemory({ services })
    const outcome = await client.callTool('content_getPost', { postId: VALID_POST_ID })
    expect(outcome.ok).toBe(false)
    const problem = expectRFC7807(problemOf(outcome), { failureDomain: 'dependency_failure' })
    expect(problem.retryable).toBe(true)
  })

  it('every problem carries a closed failure_domain', async () => {
    const { client } = setupMcpInMemory()
    const outcome = await client.callTool('does_not_exist', {})
    const problem = expectRFC7807(problemOf(outcome))
    expect(problem.next_actions.length).toBeGreaterThan(0)
  })
})

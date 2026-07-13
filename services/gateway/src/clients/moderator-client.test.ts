import { EXAMPLE_COMMUNITY_ID } from '@qaroom/contracts'
import {
  hangingFetch,
  type MockUpstream,
  mockUpstream,
  undiciFetch,
} from '@qaroom/testing-utils/http'
import { afterEach, describe, expect, it } from 'vitest'
import { createModeratorClient } from './moderator-client'

/**
 * The moderator-agent is the one Python service (ADR-0018) and is NOT a Pact provider, so its read
 * surface is pinned here at the gateway client: the URL paths the client builds (the community id
 * and decision id must stay distinct path segments), the JSON parse, and the bounded-timeout
 * fast-fail. Outbound calls go through undici's MockAgent via the injected `undiciFetch`.
 */
const BASE_URL = 'http://moderator'
const DECISION_ID = 'mdec_0000000000000000000000'
const DECISIONS_PATH = `/api/communities/${EXAMPLE_COMMUNITY_ID}/moderation-decisions`

describe('createModeratorClient.listDecisions', () => {
  let up: MockUpstream

  afterEach(async () => {
    await up.restore()
  })

  it('issues a GET to the community moderation-decisions collection and returns the parsed body', async () => {
    const captured: { method?: string; path?: string } = {}
    up = mockUpstream()
    up.pool(BASE_URL)
      .intercept({ path: DECISIONS_PATH, method: 'GET' })
      .reply((opts) => {
        captured.method = opts.method
        captured.path = opts.path
        return { statusCode: 200, data: { decisions: [] } }
      })

    const res = await createModeratorClient(BASE_URL, { fetchImpl: undiciFetch }).listDecisions(
      EXAMPLE_COMMUNITY_ID,
    )

    expect(captured.method).toBe('GET')
    expect(captured.path).toBe(DECISIONS_PATH)
    expect(res.body).toEqual({ decisions: [] })
  })
})

describe('createModeratorClient.getDecision', () => {
  let up: MockUpstream

  afterEach(async () => {
    await up.restore()
  })

  it('issues a GET to the single moderation-decision path with the community id and decision id as distinct segments', async () => {
    const captured: { path?: string } = {}
    up = mockUpstream()
    up.pool(BASE_URL)
      .intercept({ path: `${DECISIONS_PATH}/${DECISION_ID}`, method: 'GET' })
      .reply((opts) => {
        captured.path = opts.path
        return { statusCode: 200, data: { id: DECISION_ID } }
      })

    await createModeratorClient(BASE_URL, { fetchImpl: undiciFetch }).getDecision(
      EXAMPLE_COMMUNITY_ID,
      DECISION_ID,
    )

    expect(captured.path).toBe(`${DECISIONS_PATH}/${DECISION_ID}`)
    expect(captured.path).toContain(`/${EXAMPLE_COMMUNITY_ID}/moderation-decisions/${DECISION_ID}`)
  })
})

describe('createModeratorClient timeout seam', () => {
  it('fast-fails with a TimeoutError when the bounded timeout elapses (a partitioned agent)', async () => {
    const client = createModeratorClient(BASE_URL, { timeoutMs: 0, fetchImpl: hangingFetch })

    await expect(client.listDecisions(EXAMPLE_COMMUNITY_ID)).rejects.toMatchObject({
      name: 'TimeoutError',
    })
  })
})

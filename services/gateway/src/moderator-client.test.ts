import { EXAMPLE_COMMUNITY_ID } from '@qaroom/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createModeratorClient } from './moderator-client'

const BASE_URL = 'http://moderator'
const DECISION_ID = 'mdec_0000000000000000000000'

interface CapturedRequest {
  url: string
  method: string | undefined
  signal: AbortSignal | undefined
}

/**
 * Stub the global `fetch` and capture what the upstream seam actually sends. The moderator-agent
 * is the one Python service (ADR-0018) and is NOT a Pact provider, so its read surface is pinned
 * here at the gateway client instead: the URL path + method the client builds, and the bounded
 * timeout seam. The stub answers with an empty 200 so `upstreamCall` returns cleanly.
 */
function stubFetch(captured: CapturedRequest[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      captured.push({ url, method: init?.method, signal: init?.signal ?? undefined })
      return new Response('', { status: 200 })
    }),
  )
}

const oneMacrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createModeratorClient.listDecisions', () => {
  it('issues a GET to the community moderation-decisions collection path', async () => {
    const captured: CapturedRequest[] = []
    stubFetch(captured)

    await createModeratorClient(BASE_URL).listDecisions(EXAMPLE_COMMUNITY_ID)

    expect(captured).toHaveLength(1)
    expect(captured[0]?.method).toBe('GET')
    expect(captured[0]?.url).toBe(
      `${BASE_URL}/api/communities/${EXAMPLE_COMMUNITY_ID}/moderation-decisions`,
    )
  })
})

describe('createModeratorClient.getDecision', () => {
  it('issues a GET to the single moderation-decision path including the decision id', async () => {
    const captured: CapturedRequest[] = []
    stubFetch(captured)

    await createModeratorClient(BASE_URL).getDecision(EXAMPLE_COMMUNITY_ID, DECISION_ID)

    expect(captured).toHaveLength(1)
    expect(captured[0]?.method).toBe('GET')
    expect(captured[0]?.url).toBe(
      `${BASE_URL}/api/communities/${EXAMPLE_COMMUNITY_ID}/moderation-decisions/${DECISION_ID}`,
    )
  })

  it('does not coalesce the community id and decision id into a single path segment', async () => {
    const captured: CapturedRequest[] = []
    stubFetch(captured)

    await createModeratorClient(BASE_URL).getDecision(EXAMPLE_COMMUNITY_ID, DECISION_ID)

    expect(captured[0]?.url).toContain(
      `/${EXAMPLE_COMMUNITY_ID}/moderation-decisions/${DECISION_ID}`,
    )
  })
})

describe('createModeratorClient timeout seam', () => {
  it('passes a real AbortSignal to the upstream fetch', async () => {
    const captured: CapturedRequest[] = []
    stubFetch(captured)

    await createModeratorClient(BASE_URL).listDecisions(EXAMPLE_COMMUNITY_ID)

    expect(captured[0]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('applies a non-immediate default timeout when no timeoutMs option is given', async () => {
    const captured: CapturedRequest[] = []
    stubFetch(captured)

    await createModeratorClient(BASE_URL).listDecisions(EXAMPLE_COMMUNITY_ID)
    await oneMacrotask()

    // The default (upstreamTimeoutMs(), 5000ms) is far from elapsed after one macrotask, so its
    // signal is still live — distinguishing it from an instant-abort 0ms timeout.
    expect(captured[0]?.signal?.aborted).toBe(false)
  })

  it('honors an explicit zero timeoutMs by aborting the call within one macrotask', async () => {
    const captured: CapturedRequest[] = []
    stubFetch(captured)

    await createModeratorClient(BASE_URL, { timeoutMs: 0 }).listDecisions(EXAMPLE_COMMUNITY_ID)
    await oneMacrotask()

    expect(captured[0]?.signal?.aborted).toBe(true)
  })
})

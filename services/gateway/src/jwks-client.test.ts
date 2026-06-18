import { afterEach, describe, expect, it, vi } from 'vitest'
import { createJwksClient } from './jwks-client'

const BASE_URL = 'http://identity'

interface CapturedRequest {
  url: string
  method: string | undefined
  signal: AbortSignal | undefined
}

/**
 * Stub the global `fetch` and capture what the JWKS seam sends. The happy-path JWKS contract is
 * pinned by the Pact consumer spec; these tests pin the NEW behavior the bounded-timeout seam adds
 * (a reliability fix, not silent dedup): a real AbortSignal, an honored explicit `{ timeoutMs: 0 }`
 * partition fast-fail (mirroring `moderator-client.test.ts`), and a tolerant non-JSON parse.
 */
function stubFetch(captured: CapturedRequest[], response: Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      captured.push({ url, method: init?.method, signal: init?.signal ?? undefined })
      return response
    }),
  )
}

const oneMacrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createJwksClient.getJwks', () => {
  it('issues a GET to the /jwks.json path', async () => {
    const captured: CapturedRequest[] = []
    stubFetch(captured, new Response('{"keys":[]}', { status: 200 }))

    await createJwksClient(BASE_URL).getJwks()

    expect(captured).toHaveLength(1)
    expect(captured[0]?.method).toBe('GET')
    expect(captured[0]?.url).toBe(`${BASE_URL}/jwks.json`)
  })
})

describe('createJwksClient timeout seam', () => {
  it('passes a real AbortSignal to the upstream fetch', async () => {
    const captured: CapturedRequest[] = []
    stubFetch(captured, new Response('{"keys":[]}', { status: 200 }))

    await createJwksClient(BASE_URL).getJwks()

    expect(captured[0]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('honors an explicit zero timeoutMs by aborting the call within one macrotask', async () => {
    const captured: CapturedRequest[] = []
    stubFetch(captured, new Response('{"keys":[]}', { status: 200 }))

    await createJwksClient(BASE_URL, { timeoutMs: 0 }).getJwks()
    await oneMacrotask()

    expect(captured[0]?.signal?.aborted).toBe(true)
  })
})

describe('createJwksClient non-JSON tolerance', () => {
  it('returns a non-JSON 5xx body as raw text instead of throwing', async () => {
    const captured: CapturedRequest[] = []
    stubFetch(captured, new Response('<html>502 Bad Gateway</html>', { status: 502 }))

    const res = await createJwksClient(BASE_URL).getJwks()

    expect(res.status).toBe(502)
    expect(res.body).toBe('<html>502 Bad Gateway</html>')
  })
})

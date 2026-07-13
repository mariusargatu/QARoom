import { EXAMPLE_COMMUNITY_ID } from '@qaroom/contracts'
import { type MockUpstream, mockUpstream, undiciFetch } from '@qaroom/testing-utils/http'
import { afterEach, describe, expect, it } from 'vitest'
import { createFlagsClient } from './flags-client'

/**
 * The gateway→flags client is verified end-to-end by its Pact consumer test; this pins the one
 * read mapper the Pact does not exercise — `listFlags` builds the collection path (no flag-key
 * segment) and returns the parsed body. Outbound calls go through undici's MockAgent via the
 * injected `undiciFetch` (Node's global fetch ignores a test-installed dispatcher).
 */
const BASE_URL = 'http://flags'
const LIST_PATH = `/api/communities/${EXAMPLE_COMMUNITY_ID}/flags`

describe('createFlagsClient.listFlags', () => {
  let up: MockUpstream

  afterEach(async () => {
    await up.restore()
  })

  it('issues a GET to the community flags collection and returns the parsed body', async () => {
    const captured: { method?: string; path?: string } = {}
    up = mockUpstream()
    up.pool(BASE_URL)
      .intercept({ path: LIST_PATH, method: 'GET' })
      .reply((opts) => {
        captured.method = opts.method
        captured.path = opts.path
        return { statusCode: 200, data: { flags: [] } }
      })

    const res = await createFlagsClient(BASE_URL, { fetchImpl: undiciFetch }).listFlags(
      EXAMPLE_COMMUNITY_ID,
    )

    expect(captured.method).toBe('GET')
    expect(captured.path).toBe(LIST_PATH)
    expect(res.body).toEqual({ flags: [] })
  })
})

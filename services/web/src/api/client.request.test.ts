import {
  EXAMPLE_COMMUNITY_ID,
  EXAMPLE_DECISION_ID,
  EXAMPLE_FLAG_KEY,
  EXAMPLE_POST_ID,
  EXAMPLE_USER_ID,
  EXAMPLE_WEBHOOK_SUBSCRIPTION_ID,
  EXAMPLE_WEBHOOK_URL,
} from '@qaroom/contracts'
import { UlidIdGenerator } from '@qaroom/determinism'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from './client'
import { createApiClient } from './client'

/**
 * What `client.test.ts` cannot see.
 *
 * That file is 33 tests of "stub a 200 with a valid body, assert the value came back". Every one of
 * them passes if you delete the Zod parsing entirely — proven by replacing
 * `return parse(await res.json())` with `return (await res.json()) as T` in http.ts and running the
 * node AND browser tiers: 391 tests, all green. It also never looks at the request, so a wrong URL
 * or verb is invisible.
 *
 * So this file asserts the two things the response-shaped tests structurally cannot:
 *
 *   1. WHERE each call goes — method and URL — so a mistyped path fails here, not in production.
 *   2. That a contract-violating 2xx REJECTS, which is the only assertion that actually requires the
 *      Zod parse to exist. `{}` violates every response contract, so one table covers every method.
 *
 * Table-driven on purpose: a new ApiClient method with no row here is a visible omission, and the
 * count assertion below fails if the table drifts behind the interface.
 */
const BASE = 'http://gateway'
const api = () => createApiClient(BASE, new UlidIdGenerator())
const comm = `/api/communities/${EXAMPLE_COMMUNITY_ID}`

interface Call {
  name: string
  method: 'GET' | 'POST' | 'DELETE'
  path: string
  invoke: (client: ApiClient) => Promise<unknown>
  /** DELETE has no response body to validate, so it is exempt from the parse-rejection case. */
  parses?: false
}

const CALLS: readonly Call[] = [
  {
    name: 'createUser',
    method: 'POST',
    path: '/api/users',
    invoke: (c) => c.createUser({ handle: 'ada', display_name: 'Ada' }),
  },
  {
    name: 'getUser',
    method: 'GET',
    path: `/api/users/${EXAMPLE_USER_ID}`,
    invoke: (c) => c.getUser(EXAMPLE_USER_ID),
  },
  {
    name: 'createCommunity',
    method: 'POST',
    path: '/api/communities',
    invoke: (c) => c.createCommunity({ slug: 'general', name: 'General' }),
  },
  {
    name: 'addMembership',
    method: 'POST',
    path: `${comm}/members`,
    invoke: (c) =>
      c.addMembership(EXAMPLE_COMMUNITY_ID, { user_id: EXAMPLE_USER_ID, role: 'member' }),
  },
  {
    name: 'listMembers',
    method: 'GET',
    path: `${comm}/members`,
    invoke: (c) => c.listMembers(EXAMPLE_COMMUNITY_ID),
  },
  {
    name: 'createSession',
    method: 'POST',
    path: '/api/sessions',
    invoke: (c) => c.createSession(EXAMPLE_USER_ID),
  },
  {
    name: 'createWsTicket',
    method: 'POST',
    path: '/ws/tickets',
    invoke: (c) => c.createWsTicket('access-token'),
  },
  {
    name: 'listFeed',
    method: 'GET',
    path: `${comm}/feed`,
    invoke: (c) => c.listFeed(EXAMPLE_COMMUNITY_ID),
  },
  {
    name: 'getPost',
    method: 'GET',
    path: `/api/posts/${EXAMPLE_POST_ID}`,
    invoke: (c) => c.getPost(EXAMPLE_POST_ID),
  },
  {
    name: 'createPost',
    method: 'POST',
    path: `${comm}/posts`,
    invoke: (c) =>
      c.createPost(EXAMPLE_COMMUNITY_ID, {
        author_id: EXAMPLE_USER_ID,
        title: 'Title',
        body: 'Body',
      }),
  },
  {
    name: 'castVote',
    method: 'POST',
    path: `/api/posts/${EXAMPLE_POST_ID}/votes`,
    invoke: (c) => c.castVote(EXAMPLE_POST_ID, { voter_id: EXAMPLE_USER_ID, value: 1 }),
  },
  {
    name: 'listDonations',
    method: 'GET',
    path: `${comm}/donations`,
    invoke: (c) => c.listDonations(EXAMPLE_COMMUNITY_ID),
  },
  {
    name: 'createDonation',
    method: 'POST',
    path: `${comm}/donations`,
    invoke: (c) =>
      c.createDonation(EXAMPLE_COMMUNITY_ID, {
        donor_id: EXAMPLE_USER_ID,
        amount_cents: 2500,
        currency: 'USD',
      }),
  },
  {
    name: 'resolveFlag',
    method: 'GET',
    path: `${comm}/flags/${EXAMPLE_FLAG_KEY}`,
    invoke: (c) => c.resolveFlag(EXAMPLE_COMMUNITY_ID, EXAMPLE_FLAG_KEY),
  },
  {
    name: 'listFlags',
    method: 'GET',
    path: `${comm}/flags`,
    invoke: (c) => c.listFlags(EXAMPLE_COMMUNITY_ID),
  },
  {
    name: 'advanceRollout',
    method: 'POST',
    path: `${comm}/flags/${EXAMPLE_FLAG_KEY}/rollout`,
    invoke: (c) => c.advanceRollout(EXAMPLE_COMMUNITY_ID, EXAMPLE_FLAG_KEY, 'EnableRequested'),
  },
  {
    name: 'listEvents',
    method: 'GET',
    path: `${comm}/events?after=7`,
    invoke: (c) => c.listEvents(EXAMPLE_COMMUNITY_ID, 7, 'access-token'),
  },
  {
    name: 'listWebhooks',
    method: 'GET',
    path: `${comm}/webhook-subscriptions`,
    invoke: (c) => c.listWebhooks(EXAMPLE_COMMUNITY_ID),
  },
  {
    name: 'getWebhook',
    method: 'GET',
    path: `${comm}/webhook-subscriptions/${EXAMPLE_WEBHOOK_SUBSCRIPTION_ID}`,
    invoke: (c) => c.getWebhook(EXAMPLE_COMMUNITY_ID, EXAMPLE_WEBHOOK_SUBSCRIPTION_ID),
  },
  {
    name: 'createWebhook',
    method: 'POST',
    path: `${comm}/webhook-subscriptions`,
    invoke: (c) =>
      c.createWebhook(EXAMPLE_COMMUNITY_ID, {
        url: EXAMPLE_WEBHOOK_URL,
        event_types: ['post.created'],
      }),
  },
  {
    name: 'deleteWebhook',
    method: 'DELETE',
    path: `${comm}/webhook-subscriptions/${EXAMPLE_WEBHOOK_SUBSCRIPTION_ID}`,
    invoke: (c) => c.deleteWebhook(EXAMPLE_COMMUNITY_ID, EXAMPLE_WEBHOOK_SUBSCRIPTION_ID),
    parses: false,
  },
  {
    name: 'pauseWebhook',
    method: 'POST',
    path: `${comm}/webhook-subscriptions/${EXAMPLE_WEBHOOK_SUBSCRIPTION_ID}/pause`,
    invoke: (c) => c.pauseWebhook(EXAMPLE_COMMUNITY_ID, EXAMPLE_WEBHOOK_SUBSCRIPTION_ID),
  },
  {
    name: 'resumeWebhook',
    method: 'POST',
    path: `${comm}/webhook-subscriptions/${EXAMPLE_WEBHOOK_SUBSCRIPTION_ID}/resume`,
    invoke: (c) => c.resumeWebhook(EXAMPLE_COMMUNITY_ID, EXAMPLE_WEBHOOK_SUBSCRIPTION_ID),
  },
  {
    name: 'listWebhookDeliveries',
    method: 'GET',
    path: `${comm}/webhook-subscriptions/${EXAMPLE_WEBHOOK_SUBSCRIPTION_ID}/deliveries`,
    invoke: (c) => c.listWebhookDeliveries(EXAMPLE_COMMUNITY_ID, EXAMPLE_WEBHOOK_SUBSCRIPTION_ID),
  },
  {
    name: 'listModerationDecisions',
    method: 'GET',
    path: `${comm}/moderation-decisions`,
    invoke: (c) => c.listModerationDecisions(EXAMPLE_COMMUNITY_ID),
  },
  {
    name: 'getModerationDecision',
    method: 'GET',
    path: `${comm}/moderation-decisions/${EXAMPLE_DECISION_ID}`,
    invoke: (c) => c.getModerationDecision(EXAMPLE_COMMUNITY_ID, EXAMPLE_DECISION_ID),
  },
]

/** Answers every request with a 2xx whose body satisfies no contract, capturing what was sent. */
function captureFetch(body: unknown = {}) {
  const sent: Array<{ url: string; method: string; headers: Record<string, string> }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      sent.push({
        url: String(url),
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
      })
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
  return sent
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('every api client call reaches the endpoint it claims', () => {
  it('covers every method on the ApiClient interface (no silent gaps in the table)', () => {
    const covered = new Set(CALLS.map((c) => c.name))
    const implemented = Object.keys(api())
    expect([...implemented].filter((name) => !covered.has(name))).toEqual([])
    expect(covered.size).toBe(implemented.length)
  })

  it.each(CALLS)('$name issues $method $path', async ({ method, path, invoke }) => {
    const sent = captureFetch()
    await invoke(api()).catch(() => undefined) // the invalid body rejects; the request still happened
    expect(sent).toHaveLength(1)
    expect(sent[0]?.method).toBe(method)
    expect(sent[0]?.url).toBe(`${BASE}${path}`)
  })
})

describe('a 2xx that violates its contract is rejected, not handed to the UI', () => {
  it.each(
    CALLS.filter((c) => c.parses !== false),
  )('$name rejects when the gateway returns a well-formed but contract-violating body', async ({
    invoke,
  }) => {
    captureFetch({})
    await expect(invoke(api())).rejects.toThrow()
  })
})

describe('credentials and path safety', () => {
  // ADR-0025 put the events route behind edge auth: the gateway calls
  // `verifyToken.verify(req.headers.authorization)` before anything else, and the published spec
  // attaches `authRequired401` to listEvents. The web client sent no Authorization header on ANY
  // GET, so every poll of the Commitment-11 fallback was a 401 against a real gateway.
  it('sends the bearer on the events poll, which the gateway requires', async () => {
    const sent = captureFetch()
    await api()
      .listEvents(EXAMPLE_COMMUNITY_ID, 0, 'access-token')
      .catch(() => undefined)
    expect(sent[0]?.headers.authorization).toBe('Bearer access-token')
  })

  it('omits Authorization entirely when the caller has no token', async () => {
    const sent = captureFetch()
    await api()
      .listEvents(EXAMPLE_COMMUNITY_ID, 0)
      .catch(() => undefined)
    expect(sent[0]?.headers.authorization).toBeUndefined()
  })

  // A community id comes straight from the URL bar via useParams. Interpolated raw, `../../` walks
  // the request off its endpoint to an attacker-chosen same-origin path — with a valid
  // Idempotency-Key attached, in the case of a mutation.
  it('percent-encodes path parameters so a crafted id cannot escape its endpoint', async () => {
    const sent = captureFetch()
    await api()
      .listMembers('../../evil')
      .catch(() => undefined)
    expect(sent[0]?.url).toBe(`${BASE}/api/communities/..%2F..%2Fevil/members`)
    expect(new URL(sent[0]?.url ?? '').pathname).toContain('/api/communities/')
  })
})

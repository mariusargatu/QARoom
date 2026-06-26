import {
  EXAMPLE_AS_OF,
  EXAMPLE_COMMUNITY,
  EXAMPLE_COMMUNITY_ID,
  EXAMPLE_DECISION_ID,
  EXAMPLE_DONATION,
  EXAMPLE_DONATION_ID,
  EXAMPLE_FLAG_KEY,
  EXAMPLE_FLAG_RESOLUTION,
  EXAMPLE_KEY_ID,
  EXAMPLE_MEMBERSHIP,
  EXAMPLE_MODERATION_DECISION,
  EXAMPLE_POST,
  EXAMPLE_POST_ID,
  EXAMPLE_SESSION_ID,
  EXAMPLE_TICKET_ID,
  EXAMPLE_USER,
  EXAMPLE_USER_ID,
  EXAMPLE_WEBHOOK_DELIVERY,
  EXAMPLE_WEBHOOK_SUBSCRIPTION,
  EXAMPLE_WEBHOOK_SUBSCRIPTION_ID,
  EXAMPLE_WEBHOOK_URL,
  EXAMPLE_WHEN,
  makeProblem,
} from '@qaroom/contracts'
import { UlidIdGenerator } from '@qaroom/determinism'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApiClient } from './client'
import { ApiError, createHttp } from './http'

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the gateway api client', () => {
  it('sends a distinct Idempotency-Key on each mutating call', async () => {
    const keys: Array<string | undefined> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>
        keys.push(headers['idempotency-key'])
        return okJson(EXAMPLE_FLAG_RESOLUTION)
      }),
    )
    const api = createApiClient('http://gateway', new UlidIdGenerator())
    await api.advanceRollout(EXAMPLE_COMMUNITY_ID, 'donations', 'EnableRequested')
    await api.advanceRollout(EXAMPLE_COMMUNITY_ID, 'donations', 'CanaryConfirmed')
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
  })

  it('parses a flag resolution from the gateway response through the contract', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okJson(EXAMPLE_FLAG_RESOLUTION)),
    )
    const api = createApiClient('http://gateway', new UlidIdGenerator())
    const flag = await api.resolveFlag(EXAMPLE_COMMUNITY_ID, 'donations')
    expect(flag.state).toBe('Enabled')
  })

  it('throws a typed ApiError carrying the RFC 7807 problem on a non-2xx response', async () => {
    const problem = makeProblem({
      slug: 'dependency-failure',
      title: 'Upstream donations-service unavailable',
      status: 502,
      failure_domain: 'dependency_failure',
      detail: 'The donations-service did not respond.',
      retryable: true,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(problem), {
            status: 502,
            headers: { 'content-type': 'application/problem+json' },
          }),
      ),
    )
    const api = createApiClient('http://gateway', new UlidIdGenerator())
    const err = await api.resolveFlag(EXAMPLE_COMMUNITY_ID, 'donations').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    const apiErr = err as ApiError
    expect(apiErr.status).toBe(502)
    expect(apiErr.failureDomain).toBe('dependency_failure')
    expect(apiErr.retryable).toBe(true)
    expect(apiErr.problem?.title).toBe('Upstream donations-service unavailable')
  })

  it('falls back to a generic ApiError (no problem, not retryable) when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('upstream exploded', { status: 500 })),
    )
    const api = createApiClient('http://gateway', new UlidIdGenerator())
    const err = await api.resolveFlag(EXAMPLE_COMMUNITY_ID, 'donations').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    const apiErr = err as ApiError
    expect(apiErr.status).toBe(500)
    expect(apiErr.problem).toBeUndefined()
    expect(apiErr.retryable).toBe(false)
    expect(apiErr.message).toContain('500')
  })

  it('builds a method/path/status message when the error response carries an empty body', async () => {
    // An empty body skips the JSON parse entirely (the `if (text)` guard), so the synthesized
    // message — not a Problem title — is what surfaces. Pins the no-body GET error branch.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 503 })),
    )
    const api = createApiClient('http://gateway', new UlidIdGenerator())
    const err = await api.resolveFlag(EXAMPLE_COMMUNITY_ID, 'donations').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    const apiErr = err as ApiError
    expect(apiErr.status).toBe(503)
    expect(apiErr.problem).toBeUndefined()
    expect(apiErr.message).toContain('GET')
    expect(apiErr.message).toContain('503')
  })

  it('throws a typed ApiError on a failed POST (mutating call), labelling the verb', async () => {
    const problem = makeProblem({
      slug: 'conflict',
      title: 'Rollout already advanced',
      status: 409,
      failure_domain: 'conflict',
      detail: 'The flag is past this rollout state.',
      retryable: false,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(problem), {
            status: 409,
            headers: { 'content-type': 'application/problem+json' },
          }),
      ),
    )
    const api = createApiClient('http://gateway', new UlidIdGenerator())
    const err = await api
      .advanceRollout(EXAMPLE_COMMUNITY_ID, 'donations', 'EnableRequested')
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    const apiErr = err as ApiError
    expect(apiErr.status).toBe(409)
    expect(apiErr.failureDomain).toBe('conflict')
  })

  it('throws a typed ApiError when a DELETE fails, labelling the DELETE verb', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('gone', { status: 500 })),
    )
    const api = createApiClient('http://gateway', new UlidIdGenerator())
    const err = await api
      .deleteWebhook(EXAMPLE_COMMUNITY_ID, EXAMPLE_WEBHOOK_SUBSCRIPTION_ID)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    const apiErr = err as ApiError
    expect(apiErr.status).toBe(500)
    expect(apiErr.message).toContain('DELETE')
  })

  it('serializes a nullish POST body to an empty JSON object', async () => {
    // `body ?? {}`: callers may post with no body (the pause/resume endpoints pass `{}` already, but
    // the http core must also coerce a literal `undefined`), so the wire payload is never `"null"`.
    let sentBody: BodyInit | null | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        sentBody = init?.body
        return okJson({})
      }),
    )
    const http = createHttp('http://gateway', new UlidIdGenerator())
    await http.post('/api/anything', undefined, (raw) => raw)
    expect(sentBody).toBe('{}')
  })
})

// Response bodies for the wrapper/list/envelope shapes that have no single EXAMPLE_ constant,
// composed from the canonical contract examples so they validate against the response schemas.
const EXAMPLE_MEMBER_LIST = {
  community_id: EXAMPLE_COMMUNITY_ID,
  members: [EXAMPLE_MEMBERSHIP],
  as_of: EXAMPLE_AS_OF,
}
const EXAMPLE_ACCESS_TOKEN = {
  session_id: EXAMPLE_SESSION_ID,
  access_token: 'header.payload.signature',
  token_type: 'Bearer',
  expires_at: EXAMPLE_WHEN,
  kid: EXAMPLE_KEY_ID,
}
const EXAMPLE_TICKET = { ticket: EXAMPLE_TICKET_ID, expires_in_seconds: 30 }
const EXAMPLE_FEED = {
  community_id: EXAMPLE_COMMUNITY_ID,
  posts: [EXAMPLE_POST],
  as_of: EXAMPLE_AS_OF,
}
const EXAMPLE_VOTE_RESULT = { post_id: EXAMPLE_POST_ID, score: 3, voter_value: 1 }
const EXAMPLE_DONATION_LIST = { community_id: EXAMPLE_COMMUNITY_ID, donations: [EXAMPLE_DONATION] }
const EXAMPLE_FLAG_LIST = {
  community_id: EXAMPLE_COMMUNITY_ID,
  flags: [EXAMPLE_FLAG_RESOLUTION],
  as_of: EXAMPLE_AS_OF,
}
const EXAMPLE_EVENT_PAGE = { community_id: EXAMPLE_COMMUNITY_ID, events: [], cursor: 0 }
const EXAMPLE_WEBHOOK_LIST = {
  community_id: EXAMPLE_COMMUNITY_ID,
  webhooks: [EXAMPLE_WEBHOOK_SUBSCRIPTION],
}
const EXAMPLE_WEBHOOK_WITH_SECRET = { ...EXAMPLE_WEBHOOK_SUBSCRIPTION, secret: 'whsec_write_once' }
const EXAMPLE_DELIVERY_LIST = {
  subscription_id: EXAMPLE_WEBHOOK_SUBSCRIPTION_ID,
  deliveries: [EXAMPLE_WEBHOOK_DELIVERY],
}
const EXAMPLE_DECISION_LIST = { decisions: [EXAMPLE_MODERATION_DECISION], as_of: EXAMPLE_AS_OF }

const client = () => createApiClient('http://gateway', new UlidIdGenerator())
const stubOkOnce = (body: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => okJson(body)),
  )

describe('the gateway api client parses every read and write through its contract', () => {
  it('parses the created user through the User contract', async () => {
    stubOkOnce(EXAMPLE_USER)
    const user = await client().createUser({ handle: 'ada', display_name: 'Ada Lovelace' })
    expect(user.id).toBe(EXAMPLE_USER_ID)
  })

  it('parses a fetched user through the User contract', async () => {
    stubOkOnce(EXAMPLE_USER)
    const user = await client().getUser(EXAMPLE_USER_ID)
    expect(user.id).toBe(EXAMPLE_USER_ID)
  })

  it('parses the created community through the Community contract', async () => {
    stubOkOnce(EXAMPLE_COMMUNITY)
    const community = await client().createCommunity({ slug: 'general', name: 'General' })
    expect(community.id).toBe(EXAMPLE_COMMUNITY_ID)
  })

  it('parses an added membership through the Membership contract', async () => {
    stubOkOnce(EXAMPLE_MEMBERSHIP)
    const membership = await client().addMembership(EXAMPLE_COMMUNITY_ID, {
      user_id: EXAMPLE_USER_ID,
      role: 'member',
    })
    expect(membership.user_id).toBe(EXAMPLE_USER_ID)
    expect(membership.community_id).toBe(EXAMPLE_COMMUNITY_ID)
  })

  it('parses the member list and its read envelope through the MemberList contract', async () => {
    stubOkOnce(EXAMPLE_MEMBER_LIST)
    const list = await client().listMembers(EXAMPLE_COMMUNITY_ID)
    expect(list.community_id).toBe(EXAMPLE_COMMUNITY_ID)
    expect(list.members).toHaveLength(1)
    expect(list.as_of.lamport).toBe(EXAMPLE_AS_OF.lamport)
  })

  it('parses a minted session as a Bearer AccessTokenResponse', async () => {
    stubOkOnce(EXAMPLE_ACCESS_TOKEN)
    const token = await client().createSession(EXAMPLE_USER_ID)
    expect(token.session_id).toBe(EXAMPLE_SESSION_ID)
    expect(token.token_type).toBe('Bearer')
  })

  it('parses a minted ws ticket through the TicketResponse contract', async () => {
    stubOkOnce(EXAMPLE_TICKET)
    const ticket = await client().createWsTicket('access-token')
    expect(ticket.ticket).toBe(EXAMPLE_TICKET_ID)
    expect(ticket.expires_in_seconds).toBe(30)
  })

  it('sends the bearer credential when minting a ws ticket', async () => {
    let authorization: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>
        authorization = headers.authorization
        return okJson(EXAMPLE_TICKET)
      }),
    )
    await client().createWsTicket('access-token')
    expect(authorization).toBe('Bearer access-token')
  })

  it('parses the feed and its read envelope through the Feed contract', async () => {
    stubOkOnce(EXAMPLE_FEED)
    const feed = await client().listFeed(EXAMPLE_COMMUNITY_ID)
    expect(feed.posts).toHaveLength(1)
    expect(feed.posts[0]?.id).toBe(EXAMPLE_POST_ID)
  })

  it('parses a fetched post through the Post contract', async () => {
    stubOkOnce(EXAMPLE_POST)
    const post = await client().getPost(EXAMPLE_POST_ID)
    expect(post.id).toBe(EXAMPLE_POST_ID)
  })

  it('parses a created post through the Post contract', async () => {
    stubOkOnce(EXAMPLE_POST)
    const post = await client().createPost(EXAMPLE_COMMUNITY_ID, {
      author_id: EXAMPLE_USER_ID,
      title: 'Why deterministic clocks matter',
      body: 'A short note on testability.',
    })
    expect(post.id).toBe(EXAMPLE_POST_ID)
  })

  it('parses the resulting score through the CastVoteResponse contract', async () => {
    stubOkOnce(EXAMPLE_VOTE_RESULT)
    const result = await client().castVote(EXAMPLE_POST_ID, {
      voter_id: EXAMPLE_USER_ID,
      value: 1,
    })
    expect(result.score).toBe(3)
    expect(result.voter_value).toBe(1)
  })

  it('parses the donation list through the DonationList contract', async () => {
    stubOkOnce(EXAMPLE_DONATION_LIST)
    const list = await client().listDonations(EXAMPLE_COMMUNITY_ID)
    expect(list.donations).toHaveLength(1)
    expect(list.donations[0]?.id).toBe(EXAMPLE_DONATION_ID)
  })

  it('parses a created donation through the Donation contract', async () => {
    stubOkOnce(EXAMPLE_DONATION)
    const donation = await client().createDonation(EXAMPLE_COMMUNITY_ID, {
      donor_id: EXAMPLE_USER_ID,
      amount_cents: 2500,
      currency: 'USD',
    })
    expect(donation.id).toBe(EXAMPLE_DONATION_ID)
    expect(donation.status).toBe('Captured')
  })

  it('parses the flag list and its read envelope through the FlagList contract', async () => {
    stubOkOnce(EXAMPLE_FLAG_LIST)
    const list = await client().listFlags(EXAMPLE_COMMUNITY_ID)
    expect(list.flags).toHaveLength(1)
    expect(list.flags[0]?.flag_key).toBe(EXAMPLE_FLAG_KEY)
  })

  it('parses a polling page through the EventPage contract', async () => {
    stubOkOnce(EXAMPLE_EVENT_PAGE)
    const page = await client().listEvents(EXAMPLE_COMMUNITY_ID, 0)
    expect(page.community_id).toBe(EXAMPLE_COMMUNITY_ID)
    expect(page.cursor).toBe(0)
    expect(page.events).toHaveLength(0)
  })

  it('parses the webhook subscription list through the WebhookSubscriptionList contract', async () => {
    stubOkOnce(EXAMPLE_WEBHOOK_LIST)
    const list = await client().listWebhooks(EXAMPLE_COMMUNITY_ID)
    expect(list.webhooks).toHaveLength(1)
    expect(list.webhooks[0]?.id).toBe(EXAMPLE_WEBHOOK_SUBSCRIPTION_ID)
  })

  it('parses a fetched webhook subscription through the WebhookSubscription contract', async () => {
    stubOkOnce(EXAMPLE_WEBHOOK_SUBSCRIPTION)
    const sub = await client().getWebhook(EXAMPLE_COMMUNITY_ID, EXAMPLE_WEBHOOK_SUBSCRIPTION_ID)
    expect(sub.id).toBe(EXAMPLE_WEBHOOK_SUBSCRIPTION_ID)
    expect(sub.url).toBe(EXAMPLE_WEBHOOK_URL)
  })

  it('parses the write-once secret on a created webhook subscription', async () => {
    stubOkOnce(EXAMPLE_WEBHOOK_WITH_SECRET)
    const sub = await client().createWebhook(EXAMPLE_COMMUNITY_ID, {
      url: EXAMPLE_WEBHOOK_URL,
      event_types: ['post.created'],
    })
    expect(sub.id).toBe(EXAMPLE_WEBHOOK_SUBSCRIPTION_ID)
    expect(sub.secret).toBe('whsec_write_once')
  })

  it('issues a DELETE and resolves to void when removing a webhook subscription', async () => {
    let method: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        method = init?.method
        return new Response(null, { status: 204 })
      }),
    )
    const result = await client().deleteWebhook(
      EXAMPLE_COMMUNITY_ID,
      EXAMPLE_WEBHOOK_SUBSCRIPTION_ID,
    )
    expect(method).toBe('DELETE')
    expect(result).toBeUndefined()
  })

  it('parses the subscription returned when pausing a webhook', async () => {
    stubOkOnce(EXAMPLE_WEBHOOK_SUBSCRIPTION)
    const sub = await client().pauseWebhook(EXAMPLE_COMMUNITY_ID, EXAMPLE_WEBHOOK_SUBSCRIPTION_ID)
    expect(sub.id).toBe(EXAMPLE_WEBHOOK_SUBSCRIPTION_ID)
  })

  it('parses the subscription returned when resuming a webhook', async () => {
    stubOkOnce(EXAMPLE_WEBHOOK_SUBSCRIPTION)
    const sub = await client().resumeWebhook(EXAMPLE_COMMUNITY_ID, EXAMPLE_WEBHOOK_SUBSCRIPTION_ID)
    expect(sub.id).toBe(EXAMPLE_WEBHOOK_SUBSCRIPTION_ID)
  })

  it('parses the delivery ledger through the WebhookDeliveryList contract', async () => {
    stubOkOnce(EXAMPLE_DELIVERY_LIST)
    const list = await client().listWebhookDeliveries(
      EXAMPLE_COMMUNITY_ID,
      EXAMPLE_WEBHOOK_SUBSCRIPTION_ID,
    )
    expect(list.subscription_id).toBe(EXAMPLE_WEBHOOK_SUBSCRIPTION_ID)
    expect(list.deliveries[0]?.status).toBe('Delivered')
  })

  it('parses the moderation decision list and its read envelope through the contract', async () => {
    stubOkOnce(EXAMPLE_DECISION_LIST)
    const list = await client().listModerationDecisions(EXAMPLE_COMMUNITY_ID)
    expect(list.decisions).toHaveLength(1)
    expect(list.decisions[0]?.disposition).toBe('approve')
  })

  it('parses a fetched moderation decision through the ModerationDecision contract', async () => {
    stubOkOnce(EXAMPLE_MODERATION_DECISION)
    const decision = await client().getModerationDecision(EXAMPLE_COMMUNITY_ID, EXAMPLE_DECISION_ID)
    expect(decision.decision_id).toBe(EXAMPLE_DECISION_ID)
    expect(decision.disposition).toBe('approve')
  })
})

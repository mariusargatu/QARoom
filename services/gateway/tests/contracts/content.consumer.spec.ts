import { resolve } from 'node:path'
import { MatchersV3, PactV4 } from '@pact-foundation/pact'
import { EXAMPLE_COMMUNITY_ID, EXAMPLE_POST_ID, EXAMPLE_USER_ID } from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'
import { createContentClient } from '../../src/clients/content-client'

/**
 * Consumer-driven contract (Pact). The gateway declares exactly what it needs
 * from content-service; running this against the Pact mock emits
 * `services/gateway/pacts/gateway-content.json`, which content-service verifies
 * as the provider (see services/content/tests/contracts/provider.verify.ts).
 * It also exercises the real `content-client` fetch path against the mock.
 */
const { like, integer, boolean, string, regex, eachLike } = MatchersV3

// Concrete example values single-sourced from contracts (examples.ts) so the pact
// cannot silently disagree with the OAS examples on the same IDs. The MatchersV3
// regex strings below stay hand-authored — they are the deliberate independent
// second source (docs/03 §6) and must NOT be derived from contracts.
const EXISTING_POST = EXAMPLE_POST_ID
const MISSING_POST = 'post_01HZY0K7M3QF8VN2J5RX9TB4XX'
const COMMUNITY = EXAMPLE_COMMUNITY_ID
const USER = EXAMPLE_USER_ID

const POST_RE = '^post_[0-9A-HJKMNP-TV-Z]{26}$'
const COMM_RE = '^comm_[0-9A-HJKMNP-TV-Z]{26}$'
const USER_RE = '^user_[0-9A-HJKMNP-TV-Z]{26}$'
const ISO_RE = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'

const postBody = {
  id: regex(POST_RE, EXISTING_POST),
  community_id: regex(COMM_RE, COMMUNITY),
  author_id: regex(USER_RE, USER),
  title: string('seeded title'),
  body: string('seeded body'),
  score: integer(0),
  created_at: regex(ISO_RE, '2026-01-01T00:00:00.000Z'),
}

const existingPostState = {
  id: EXISTING_POST,
  community_id: COMMUNITY,
  author_id: USER,
  title: 'seeded title',
  body: 'seeded body',
}

const pact = new PactV4({
  consumer: 'gateway',
  provider: 'content',
  dir: resolve(import.meta.dirname, '../../pacts'),
  logLevel: 'warn',
})

describe('gateway → content consumer contract', () => {
  it('fetches an existing post', async () => {
    await pact
      .addInteraction()
      .given('a post exists', existingPostState)
      .uponReceiving('a request to get an existing post')
      .withRequest('GET', `/api/posts/${EXISTING_POST}`)
      .willRespondWith(200, (b) => b.jsonBody(like(postBody)))
      .executeTest(async (mock) => {
        const res = await createContentClient(mock.url).getPost(EXISTING_POST)
        expect(res.status).toBe(200)
      })
  })

  it('receives a 404 problem for a missing post', async () => {
    await pact
      .addInteraction()
      .given('no such post exists', { id: MISSING_POST })
      .uponReceiving('a request to get a missing post')
      .withRequest('GET', `/api/posts/${MISSING_POST}`)
      .willRespondWith(404, (b) =>
        b
          .headers({
            'content-type': regex('application/problem\\+json.*', 'application/problem+json'),
          })
          .jsonBody(
            like({
              type: string('https://qaroom.dev/errors/post-not-found'),
              title: string('Post not found'),
              status: integer(404),
              retryable: boolean(false),
              failure_domain: string('not_found'),
              next_actions: eachLike({
                verb: string('GET'),
                href: string('/api/communities/{communityId}/feed'),
                description: string('Browse a community feed to find posts.'),
              }),
            }),
          ),
      )
      .executeTest(async (mock) => {
        const res = await createContentClient(mock.url).getPost(MISSING_POST)
        expect(res.status).toBe(404)
      })
  })

  it('creates a post', async () => {
    await pact
      .addInteraction()
      .uponReceiving('a request to create a post')
      .withRequest('POST', `/api/communities/${COMMUNITY}/posts`, (b) =>
        b
          .headers({ 'content-type': 'application/json', 'Idempotency-Key': like('idem-create-1') })
          .jsonBody({ author_id: USER, title: 'a new post', body: 'hello' }),
      )
      .willRespondWith(201, (b) => b.jsonBody(like(postBody)))
      .executeTest(async (mock) => {
        const res = await createContentClient(mock.url).createPost(
          COMMUNITY,
          { author_id: USER, title: 'a new post', body: 'hello' },
          'idem-create-1',
        )
        expect(res.status).toBe(201)
      })
  })

  it('casts a vote on an existing post', async () => {
    await pact
      .addInteraction()
      .given('a post exists', existingPostState)
      .uponReceiving('a request to vote on a post')
      .withRequest('POST', `/api/posts/${EXISTING_POST}/votes`, (b) =>
        b
          .headers({ 'content-type': 'application/json', 'Idempotency-Key': like('idem-vote-1') })
          .jsonBody({ voter_id: USER, value: 1 }),
      )
      .willRespondWith(200, (b) =>
        b.jsonBody(
          like({
            post_id: regex(POST_RE, EXISTING_POST),
            score: integer(1),
            voter_value: integer(1),
          }),
        ),
      )
      .executeTest(async (mock) => {
        const res = await createContentClient(mock.url).castVote(
          EXISTING_POST,
          { voter_id: USER, value: 1 },
          'idem-vote-1',
        )
        expect(res.status).toBe(200)
      })
  })

  it('lists a community feed', async () => {
    await pact
      .addInteraction()
      .given('a post exists', existingPostState)
      .uponReceiving('a request for a community feed')
      .withRequest('GET', `/api/communities/${COMMUNITY}/feed`)
      .willRespondWith(200, (b) =>
        b.jsonBody(
          like({
            community_id: regex(COMM_RE, COMMUNITY),
            posts: eachLike(postBody),
            as_of: like({
              snapshot_id: string('snap_01HZY0K7M3QF8VN2J5RX9TB4CD'),
              lamport: integer(0),
              wall_clock: regex(ISO_RE, '2026-01-01T00:00:00.000Z'),
            }),
          }),
        ),
      )
      .executeTest(async (mock) => {
        const res = await createContentClient(mock.url).getFeed(COMMUNITY)
        expect(res.status).toBe(200)
      })
  })
})

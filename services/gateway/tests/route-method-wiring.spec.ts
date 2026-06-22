import {
  EXAMPLE_COMMUNITY,
  EXAMPLE_DECISION_ID,
  EXAMPLE_DONATION_ID,
  EXAMPLE_FLAG_KEY,
  EXAMPLE_POST_ID,
  EXAMPLE_USER,
  EXAMPLE_USER_ID,
} from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'
import {
  recordingContent,
  recordingDonations,
  recordingFlags,
  recordingIdentity,
  recordingModerator,
  SAMPLE,
  setupGatewayTest,
} from './harness'

/**
 * Route → upstream-method wiring (route-to-client-method-miswire).
 *
 * Every upstream client here is a RECORDING stub: each method tags its reply with `calledMethod`.
 * A route bound to the wrong (same-signature) sibling method — e.g. `listMembers` accidentally
 * calling `getUser` — would return the wrong tag, so asserting the EXPECTED method name per route
 * is the oracle that a constant-reply stub cannot give (it collapses every method to one body).
 */
function recordingGateway() {
  return setupGatewayTest(recordingContent(), {
    donations: recordingDonations(),
    flags: recordingFlags(),
    identity: recordingIdentity(),
    moderator: recordingModerator(),
    rateLimit: { capacity: 1000, refillPerSec: 0 },
  })
}

const c = SAMPLE.community
const key = { 'idempotency-key': 'wiring-key' }

const postBody = { author_id: SAMPLE.user, title: 't', body: 'b' }
const voteBody = { voter_id: SAMPLE.user, value: 1 }
const donationBody = { donor_id: EXAMPLE_USER_ID, amount_cents: 2500, currency: 'USD' }
const rolloutBody = { event: 'EnableRequested' }
const userBody = { handle: EXAMPLE_USER.handle, display_name: EXAMPLE_USER.display_name }
const communityBody = { slug: EXAMPLE_COMMUNITY.slug, name: EXAMPLE_COMMUNITY.name }
const membershipBody = { user_id: EXAMPLE_USER_ID, role: 'member' as const }
const sessionBody = { user_id: EXAMPLE_USER_ID }

const calledMethodOf = (json: unknown): string => (json as { calledMethod: string }).calledMethod

const GET_ROUTES: ReadonlyArray<readonly [string, string]> = [
  ['getFeed', `/api/communities/${c}/feed`],
  ['getPost', `/api/posts/${EXAMPLE_POST_ID}`],
  ['listDonations', `/api/communities/${c}/donations`],
  ['getDonation', `/api/communities/${c}/donations/${EXAMPLE_DONATION_ID}`],
  ['resolveFlag', `/api/communities/${c}/flags/${EXAMPLE_FLAG_KEY}`],
  ['listFlags', `/api/communities/${c}/flags`],
  ['getUser', `/api/users/${EXAMPLE_USER_ID}`],
  ['listMembers', `/api/communities/${c}/members`],
  ['listDecisions', `/api/communities/${c}/moderation-decisions`],
  ['getDecision', `/api/communities/${c}/moderation-decisions/${EXAMPLE_DECISION_ID}`],
]

const POST_ROUTES: ReadonlyArray<readonly [string, string, unknown, Record<string, string>]> = [
  ['createPost', `/api/communities/${c}/posts`, postBody, key],
  ['castVote', `/api/posts/${EXAMPLE_POST_ID}/votes`, voteBody, key],
  ['createDonation', `/api/communities/${c}/donations`, donationBody, key],
  ['advanceRollout', `/api/communities/${c}/flags/${EXAMPLE_FLAG_KEY}/rollout`, rolloutBody, key],
  ['createUser', '/api/users', userBody, key],
  ['createCommunity', '/api/communities', communityBody, key],
  ['addMembership', `/api/communities/${c}/members`, membershipBody, key],
  ['createSession', '/api/sessions', sessionBody, key],
  ['createWsTicket', '/ws/tickets', {}, { authorization: 'Bearer t.jwt' }],
]

describe('gateway route → upstream method wiring', () => {
  it.each(GET_ROUTES)('GET route invokes the %s upstream method', async (method, url) => {
    const { request } = recordingGateway()
    const res = await request.get(url)
    expect(res.status).toBe(200)
    expect(calledMethodOf(res.json)).toBe(method)
  })

  it.each(
    POST_ROUTES,
  )('POST route invokes the %s upstream method', async (method, url, body, headers) => {
    const { request } = recordingGateway()
    const res = await request.post(url, body, headers)
    expect(res.status).toBe(200)
    expect(calledMethodOf(res.json)).toBe(method)
  })
})

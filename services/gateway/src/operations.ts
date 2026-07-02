import {
  brandedPathParam,
  communityIdParam,
  EXAMPLE_AS_OF,
  EXAMPLE_COMMUNITY_ID,
  EXAMPLE_DONATION,
  EXAMPLE_FLAG_RESOLUTION,
  EXAMPLE_POST,
  EXAMPLE_POST_ID,
  EXAMPLE_USER_ID,
  idempotencyKeyHeaderParam,
  type OasOperation,
  type OasParam,
  postIdParam,
  problemResponse,
} from '@qaroom/contracts'
import { IDENTITY_OPERATIONS } from './identity-operations'
import { MODERATION_OPERATIONS } from './moderation-operations'
import { upstreamUnreachable502, validation400 } from './problem-responses'
import { CONTENT_UPSTREAM, DONATIONS_UPSTREAM, FLAGS_UPSTREAM } from './upstreams'
import { WEBHOOK_OPERATIONS } from './webhooks-operations'

/**
 * Gateway operation registry. The gateway fronts content-service, so it mirrors
 * content's read+write surface (reusing the shared `@qaroom/contracts` schemas)
 * and adds the failure modes the gateway itself originates: 502 when the upstream
 * is unreachable, 429 from the rate limiter. Single source for the gateway's
 * openapi.yaml + /system/capabilities. Common OAS pieces come from @qaroom/contracts.
 */
const notFound404 = problemResponse(404, 'post-not-found', 'Post not found', 'not_found', {
  description: 'The upstream resource does not exist.',
})
const upstream502 = upstreamUnreachable502(CONTENT_UPSTREAM, 'content-service is unreachable.')
const rateLimited429 = problemResponse(429, 'rate-limited', 'Too many requests', 'rate_limit', {
  description: 'The per-principal rate limit was exceeded. Carries a Retry-After header.',
  retryable: true,
})
const donationsUnreachable502 = upstreamUnreachable502(
  DONATIONS_UPSTREAM,
  'donations-service is unreachable, timed out, or the gateway circuit breaker is open (chaos experiments 06/07). The upstream payment-provider 502 is also surfaced here.',
)
const flagsUnreachable502 = upstreamUnreachable502(
  FLAGS_UPSTREAM,
  'flags-service is unreachable or timed out.',
)
const donationsGated409 = problemResponse(
  409,
  'donations-not-enabled',
  'Donations are not enabled',
  'conflict',
  { description: 'The donations feature flag has not reached Enabled for this community.' },
)
// The gateway EDGE 401: only routes that verify the bearer at the edge (ADR-0025 — currently
// `listEvents` + the WS handshake) return it. Not stamped fleet-wide: proxied routes let the
// downstream service own auth, and the public login/signup ops never 401. Attached per-op below.
const authRequired401 = problemResponse(
  401,
  'token-missing',
  'Authentication failed',
  'authentication',
  {
    description: 'The bearer token is missing, malformed, or expired at the gateway edge.',
    instance: '/api/communities/comm_01HZY0K7M3QF8VN2J5RX9TB4CD/events',
  },
)
const donationNotFound404 = problemResponse(
  404,
  'donation-not-found',
  'Donation not found',
  'not_found',
  { description: 'No donation with that id exists in this community.' },
)
const rolloutConflict409 = problemResponse(
  409,
  'rollout-transition-illegal',
  'Illegal rollout transition',
  'conflict',
  { description: 'The requested event is not a legal transition from the flag’s current state.' },
)

const donationIdParam = brandedPathParam('donationId', 'dntn', 'Target donation.')
const flagKeyParam: OasParam = {
  name: 'flagKey',
  in: 'path',
  required: true,
  description: 'Feature-flag key (lowercase, hyphen-separated slug).',
  schema: { type: 'string', pattern: '^[a-z][a-z0-9-]{1,63}$' },
}
const EXAMPLE_FLAG_LIST = {
  community_id: EXAMPLE_COMMUNITY_ID,
  flags: [EXAMPLE_FLAG_RESOLUTION],
  as_of: EXAMPLE_AS_OF,
}

const RAW_OPERATIONS: readonly OasOperation[] = [
  {
    operationId: 'createPost',
    method: 'post',
    path: '/api/communities/{communityId}/posts',
    summary: 'Create a post (proxied to content-service)',
    description:
      'Validates at the edge, forwards to content-service. Idempotent on the Idempotency-Key header.',
    tags: ['posts'],
    mutating: true,
    params: [communityIdParam, idempotencyKeyHeaderParam],
    requestBodyRef: 'CreatePostRequest',
    requestExample: {
      author_id: EXAMPLE_USER_ID,
      title: EXAMPLE_POST.title,
      body: EXAMPLE_POST.body,
    },
    responses: [
      {
        code: 201,
        description: 'The created post.',
        bodyRef: 'Post',
        example: EXAMPLE_POST,
        links: {
          GetCreatedPost: {
            operationId: 'getPost',
            parameters: { postId: '$response.body#/id' },
            description: 'Fetch the post that was just created.',
          },
        },
      },
      upstream502,
    ],
  },
  {
    operationId: 'listCommunityFeed',
    method: 'get',
    path: '/api/communities/{communityId}/feed',
    summary: 'List a community feed (proxied)',
    description: 'Returns the most recent posts in a community, newest first, via content-service.',
    tags: ['posts'],
    mutating: false,
    params: [communityIdParam],
    responses: [
      { code: 200, description: 'A page of community posts.', bodyRef: 'Feed' },
      upstream502,
    ],
  },
  {
    operationId: 'getPost',
    method: 'get',
    path: '/api/posts/{postId}',
    summary: 'Get a single post (proxied)',
    description: 'Returns a post by id via content-service.',
    tags: ['posts'],
    mutating: false,
    params: [postIdParam],
    responses: [
      { code: 200, description: 'The post.', bodyRef: 'Post', example: EXAMPLE_POST },
      notFound404,
      upstream502,
    ],
  },
  {
    operationId: 'castVote',
    method: 'post',
    path: '/api/posts/{postId}/votes',
    summary: 'Cast a vote on a post (proxied)',
    description:
      'Casts or changes a vote (+1 / -1) via content-service. Idempotent on Idempotency-Key.',
    tags: ['votes'],
    mutating: true,
    params: [postIdParam, idempotencyKeyHeaderParam],
    requestBodyRef: 'CastVoteRequest',
    requestExample: { voter_id: EXAMPLE_USER_ID, value: 1 },
    responses: [
      {
        code: 200,
        description: 'The recomputed post score.',
        bodyRef: 'CastVoteResponse',
        example: { post_id: EXAMPLE_POST_ID, score: 1, voter_value: 1 },
        links: {
          GetVotedPost: {
            operationId: 'getPost',
            parameters: { postId: '$response.body#/post_id' },
            description: 'Fetch the post that was voted on.',
          },
        },
      },
      notFound404,
      upstream502,
    ],
  },
  {
    operationId: 'createDonation',
    method: 'post',
    path: '/api/communities/{communityId}/donations',
    summary: 'Create a donation (proxied to donations-service)',
    description:
      'Validates at the edge, forwards to donations-service. Gated by the donations flag and settled via the payment provider. Idempotent on Idempotency-Key. The gateway circuit breaker fails fast with a 502 when donations is sick (experiment 06).',
    tags: ['donations'],
    mutating: true,
    params: [communityIdParam, idempotencyKeyHeaderParam],
    requestBodyRef: 'CreateDonationRequest',
    requestExample: { donor_id: EXAMPLE_USER_ID, amount_cents: 2500, currency: 'USD' },
    responses: [
      {
        code: 201,
        description: 'The recorded donation.',
        bodyRef: 'Donation',
        example: EXAMPLE_DONATION,
        links: {
          GetCreatedDonation: {
            operationId: 'getDonation',
            parameters: {
              communityId: '$response.body#/community_id',
              donationId: '$response.body#/id',
            },
            description: 'Fetch the donation that was just created.',
          },
        },
      },
      donationsGated409,
      donationsUnreachable502,
    ],
  },
  {
    operationId: 'listDonations',
    method: 'get',
    path: '/api/communities/{communityId}/donations',
    summary: 'List a community’s donations (proxied)',
    description:
      'Returns the most recent donations in a community, newest first, via donations-service.',
    tags: ['donations'],
    mutating: false,
    params: [communityIdParam],
    responses: [
      {
        code: 200,
        description: 'A page of donations.',
        bodyRef: 'DonationList',
        example: { community_id: EXAMPLE_COMMUNITY_ID, donations: [EXAMPLE_DONATION] },
      },
      donationsUnreachable502,
    ],
  },
  {
    operationId: 'getDonation',
    method: 'get',
    path: '/api/communities/{communityId}/donations/{donationId}',
    summary: 'Get a single donation (proxied)',
    description: 'Returns a donation by id within a community, via donations-service.',
    tags: ['donations'],
    mutating: false,
    params: [communityIdParam, donationIdParam],
    responses: [
      { code: 200, description: 'The donation.', bodyRef: 'Donation', example: EXAMPLE_DONATION },
      donationNotFound404,
      donationsUnreachable502,
    ],
  },
  {
    operationId: 'resolveFlag',
    method: 'get',
    path: '/api/communities/{communityId}/flags/{flagKey}',
    summary: 'Resolve a feature flag (proxied to flags-service)',
    description:
      'Returns the flag’s current rollout state and gating boolean, with a read envelope.',
    tags: ['flags'],
    mutating: false,
    params: [communityIdParam, flagKeyParam],
    responses: [
      {
        code: 200,
        description: 'The resolved flag.',
        bodyRef: 'FlagResolution',
        example: EXAMPLE_FLAG_RESOLUTION,
      },
      flagsUnreachable502,
    ],
  },
  {
    operationId: 'listFlags',
    method: 'get',
    path: '/api/communities/{communityId}/flags',
    summary: 'List all flags for a community (proxied)',
    description:
      'Returns every flag resolved for the community, with a read envelope, via flags-service.',
    tags: ['flags'],
    mutating: false,
    params: [communityIdParam],
    responses: [
      {
        code: 200,
        description: 'The resolved flags.',
        bodyRef: 'FlagList',
        example: EXAMPLE_FLAG_LIST,
      },
      flagsUnreachable502,
    ],
  },
  {
    operationId: 'advanceRollout',
    method: 'post',
    path: '/api/communities/{communityId}/flags/{flagKey}/rollout',
    summary: 'Advance a flag rollout (proxied)',
    description:
      'Applies one rollout event (e.g. EnableRequested). Idempotent on Idempotency-Key; an event illegal from the current state returns 409.',
    tags: ['flags'],
    mutating: true,
    params: [communityIdParam, flagKeyParam, idempotencyKeyHeaderParam],
    requestBodyRef: 'AdvanceRolloutRequest',
    requestExample: { event: 'EnableRequested' },
    responses: [
      {
        code: 200,
        description: 'The flag after the transition.',
        bodyRef: 'FlagResolution',
        example: EXAMPLE_FLAG_RESOLUTION,
        links: {
          ResolveAdvancedFlag: {
            operationId: 'resolveFlag',
            parameters: {
              communityId: '$response.body#/community_id',
              flagKey: '$response.body#/flag_key',
            },
            description: 'Re-resolve the flag that was just advanced.',
          },
        },
      },
      rolloutConflict409,
      flagsUnreachable502,
    ],
  },
  {
    operationId: 'listEvents',
    method: 'get',
    path: '/api/communities/{communityId}/events',
    summary: 'Poll community events (WebSocket fallback)',
    description:
      'Returns the push envelopes for a community after the given seq cursor — the polling fallback for the WebSocket stream (Commitment 11). Every event delivered over WS is also returned here.',
    tags: ['events'],
    mutating: false,
    params: [
      communityIdParam,
      {
        name: 'after',
        in: 'query',
        required: false,
        description: 'Return only envelopes with seq greater than this cursor.',
        schema: { type: 'integer', minimum: 0 },
      },
    ],
    responses: [
      { code: 200, description: 'A page of push envelopes.', bodyRef: 'EventPage' },
      authRequired401,
    ],
  },
  ...WEBHOOK_OPERATIONS,
  ...IDENTITY_OPERATIONS,
  ...MODERATION_OPERATIONS,
  {
    operationId: 'getSystemState',
    method: 'get',
    path: '/system/state',
    summary: 'Observable state of the gateway',
    description: 'Returns the gateway’s observable state with an as_of envelope (Commitment 7).',
    tags: ['system'],
    mutating: false,
    responses: [{ code: 200, description: 'Current observable state.', bodyRef: 'SystemState' }],
  },
  {
    operationId: 'getSystemCapabilities',
    method: 'get',
    path: '/system/capabilities',
    summary: 'Operations the gateway exposes',
    description: 'Returns every operation in MCP-tool-shaped form (Commitment 7).',
    tags: ['system'],
    mutating: false,
    responses: [{ code: 200, description: 'The capability list.', bodyRef: 'Capabilities' }],
  },
  {
    operationId: 'getSystemLimits',
    method: 'get',
    path: '/system/limits',
    summary: 'Per-principal rate-limit usage',
    description:
      'Returns the calling principal’s current rate-limit usage and time to full refill.',
    tags: ['system'],
    mutating: false,
    responses: [{ code: 200, description: 'Current rate-limit usage.', bodyRef: 'SystemLimits' }],
  },
]

// Cross-cutting gateway behaviors, declared uniformly (gauntlet phase-6 fuzz findings: live
// fuzzing surfaced 429/400/404/409 responses the per-op lists under-mirrored). Every /api/*
// route passes the SAME edge middleware, so the contract is stamped, not hand-maintained:
//   429 — the per-principal rate limiter (M1) guards all /api/* (exempt: /system, /ws)
//   400 — edge validation rejects malformed params/bodies/headers before proxying
//   404 — any path-parameterized route can miss (tenant resolution or resource)
//   409 — every mutating route shares the Idempotency-Key middleware (key reuse, new body)
const genericNotFound404 = problemResponse(
  404,
  'resource-not-found',
  'Resource not found',
  'not_found',
  {
    description: 'The community or addressed resource does not exist.',
    instance: '/api/communities/comm_01HZY0K7M3QF8VN2J5RX9TB4CD/feed',
  },
)
const idempotencyConflict409 = problemResponse(
  409,
  'idempotency-key-conflict',
  'Idempotency-Key reused with a different body',
  'conflict',
  {
    description: 'This Idempotency-Key was already used for a request with a different body.',
    instance: '/api/communities/comm_01HZY0K7M3QF8VN2J5RX9TB4CD/posts',
  },
)
export const OPERATIONS: readonly OasOperation[] = RAW_OPERATIONS.map((op) => {
  if (!op.path.startsWith('/api/')) return op
  const responses = [...op.responses]
  if (!responses.some((r) => r.code === 429)) responses.push(rateLimited429)
  if (!responses.some((r) => r.code === 400)) responses.push(validation400)
  if (op.path.includes('{') && !responses.some((r) => r.code === 404)) {
    responses.push(genericNotFound404)
  }
  if (op.mutating && !responses.some((r) => r.code === 409)) responses.push(idempotencyConflict409)
  return { ...op, responses }
})

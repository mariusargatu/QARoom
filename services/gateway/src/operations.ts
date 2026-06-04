import {
  communityIdParam,
  EXAMPLE_POST,
  EXAMPLE_POST_ID,
  EXAMPLE_USER_ID,
  idempotencyKeyHeaderParam,
  type OasOperation,
  postIdParam,
  problemResponse,
} from '@qaroom/contracts'

/**
 * Gateway operation registry. The gateway fronts content-service, so it mirrors
 * content's read+write surface (reusing the shared `@qaroom/contracts` schemas)
 * and adds the failure modes the gateway itself originates: 502 when the upstream
 * is unreachable, 429 from the rate limiter. Single source for the gateway's
 * openapi.yaml + /system/capabilities. Common OAS pieces come from @qaroom/contracts.
 */
const validation400 = problemResponse(
  400,
  'validation-failed',
  'Request failed validation',
  'validation',
  {
    description: 'The request failed validation at the gateway edge.',
  },
)
const notFound404 = problemResponse(404, 'post-not-found', 'Post not found', 'not_found', {
  description: 'The upstream resource does not exist.',
})
const upstream502 = problemResponse(
  502,
  'content-unreachable',
  'Upstream content-service unavailable',
  'dependency_failure',
  {
    description: 'content-service is unreachable.',
    retryable: true,
  },
)
const rateLimited429 = problemResponse(429, 'rate-limited', 'Too many requests', 'rate_limit', {
  description: 'The per-principal rate limit was exceeded. Carries a Retry-After header.',
  retryable: true,
})

export const OPERATIONS: readonly OasOperation[] = [
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
      validation400,
      upstream502,
      rateLimited429,
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
      validation400,
      upstream502,
      rateLimited429,
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
      validation400,
      notFound404,
      upstream502,
      rateLimited429,
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
      validation400,
      notFound404,
      upstream502,
      rateLimited429,
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
      validation400,
      rateLimited429,
    ],
  },
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

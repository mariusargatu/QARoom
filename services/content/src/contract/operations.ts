import {
  communityIdParam,
  EXAMPLE_POST,
  EXAMPLE_POST_ID,
  EXAMPLE_USER_ID,
  idempotencyConflict,
  idempotencyKeyHeaderParam,
  type OasOperation,
  postIdParam,
  problemResponse,
  SYSTEM_OPERATIONS,
  validationFailed,
} from '@qaroom/contracts'

/**
 * The canonical operation registry for content-service. This single source feeds
 * three artifacts: the committed `openapi.yaml`, the `/system/capabilities`
 * response, and the capabilities completeness test. Routes are wired by hand but
 * MUST stay in lockstep with this list (the capabilities test enforces it).
 */
const badRequest = (description: string) => validationFailed(description)
const postNotFound = problemResponse(404, 'post-not-found', 'Post not found', 'not_found', {
  description: 'No post with that id exists.',
})
// EvoMaster (Milestone 8, black-box search) found this 409 was returned by the withIdempotency
// wrapper but never declared in the spec (fault type 101). The canonical declaration now lives in
// @qaroom/contracts (idempotencyConflict) so every service shares one wording; declaring it closes
// the impl/spec drift and every mutating endpoint can return it. See docs/adr/0016-testing-your-tests.md.

export const OPERATIONS: readonly OasOperation[] = [
  {
    operationId: 'createPost',
    method: 'post',
    path: '/api/communities/{communityId}/posts',
    summary: 'Create a post in a community',
    description:
      'Creates a post. Idempotent on the Idempotency-Key header; replays return the original response.',
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
      badRequest('The request body or headers failed validation.'),
      idempotencyConflict(),
    ],
  },
  {
    operationId: 'listCommunityFeed',
    method: 'get',
    path: '/api/communities/{communityId}/feed',
    summary: 'List a community feed',
    description:
      'Returns the most recent posts in a community, newest first, with a read consistency envelope.',
    tags: ['posts'],
    mutating: false,
    params: [communityIdParam],
    responses: [
      { code: 200, description: 'A page of community posts.', bodyRef: 'Feed' },
      badRequest('The community id in the path is malformed.'),
    ],
  },
  {
    operationId: 'getPost',
    method: 'get',
    path: '/api/posts/{postId}',
    summary: 'Get a single post',
    description: 'Returns a post by id, including its current score.',
    tags: ['posts'],
    mutating: false,
    params: [postIdParam],
    responses: [
      { code: 200, description: 'The post.', bodyRef: 'Post', example: EXAMPLE_POST },
      badRequest('The post id in the path is malformed.'),
      postNotFound,
    ],
  },
  {
    operationId: 'castVote',
    method: 'post',
    path: '/api/posts/{postId}/votes',
    summary: 'Cast a vote on a post',
    description:
      'Casts or changes a vote (+1 / -1) and returns the recomputed score. Idempotent on Idempotency-Key.',
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
      postNotFound,
      badRequest('The request body or headers failed validation.'),
      idempotencyConflict(),
    ],
  },
  ...SYSTEM_OPERATIONS,
]

import {
  communityIdParam,
  EXAMPLE_AS_OF,
  EXAMPLE_COMMUNITY,
  EXAMPLE_COMMUNITY_ID,
  EXAMPLE_HANDLE,
  EXAMPLE_KEY_ID,
  EXAMPLE_MEMBERSHIP,
  EXAMPLE_SESSION_ID,
  EXAMPLE_TICKET_ID,
  EXAMPLE_USER,
  EXAMPLE_USER_ID,
  EXAMPLE_WHEN,
  idempotencyKeyHeaderParam,
  type OasOperation,
  type OasParam,
  problemResponse,
  userIdParam,
} from '@qaroom/contracts'
import { upstreamUnreachable502 } from './problem-responses'

/**
 * The identity operations the gateway proxies to identity-service (ADR-0022): user + community +
 * membership bootstrap, session issuance, and WS-ticket minting. Split out of `operations.ts` to
 * keep it under the 500-line cap; spread into the gateway OPERATIONS array. Reuses the shared
 * `@qaroom/contracts` request/response schemas (the same ones identity-service registers).
 *
 * The gateway-edge 400 is NOT hand-listed here: every `/api/*` op gets it stamped uniformly by the
 * cross-cutting map in `operations.ts` (the stamp that file documents). Only genuinely op-specific
 * responses (404/409/422/401 + the 502) live below.
 */
const identityUnreachable502 = upstreamUnreachable502(
  'identity-unreachable',
  'identity-service',
  'identity-service is unreachable or timed out.',
)
const userNotFound404 = problemResponse(404, 'user-not-found', 'User not found', 'not_found', {
  description: 'No user with that id exists.',
})
const slugConflict409 = problemResponse(
  409,
  'community-slug-taken',
  'Community slug already taken',
  'conflict',
  { description: 'A community already exists with that slug.' },
)
const membershipConflict409 = problemResponse(
  409,
  'membership-exists',
  'User is already a member',
  'conflict',
  { description: 'The user already has a membership in this community.' },
)
const wsTicketUnauthorized401 = problemResponse(
  401,
  'ws-ticket-unauthorized',
  'Authentication failed',
  'authentication',
  { description: 'The bearer access token is missing, expired, or invalid.' },
)

const authorizationHeaderParam: OasParam = {
  name: 'Authorization',
  in: 'header',
  required: true,
  description: 'Bearer access token (the JWT from createSession). Verified by identity-service.',
  schema: { type: 'string', pattern: '^Bearer .+' },
}

export const IDENTITY_OPERATIONS: readonly OasOperation[] = [
  {
    operationId: 'createUser',
    method: 'post',
    path: '/api/users',
    summary: 'Create a user identity (proxied to identity-service)',
    description:
      'Registers a user (handle + display name). Idempotent on Idempotency-Key. Credentials are out of scope (ADR-0022): there is no password — a session is issued from the user id alone.',
    tags: ['identity'],
    mutating: true,
    params: [idempotencyKeyHeaderParam],
    requestBodyRef: 'CreateUserRequest',
    requestExample: { handle: EXAMPLE_HANDLE, display_name: EXAMPLE_USER.display_name },
    responses: [
      {
        code: 201,
        description: 'The created user.',
        bodyRef: 'User',
        example: EXAMPLE_USER,
        links: {
          GetCreatedUser: {
            operationId: 'getUser',
            parameters: { userId: '$response.body#/id' },
            description: 'Fetch the user that was just created.',
          },
        },
      },
      identityUnreachable502,
    ],
  },
  {
    operationId: 'getUser',
    method: 'get',
    path: '/api/users/{userId}',
    summary: 'Get a user by id (proxied)',
    description: 'Returns a user identity by id, via identity-service.',
    tags: ['identity'],
    mutating: false,
    params: [userIdParam],
    responses: [
      { code: 200, description: 'The user.', bodyRef: 'User', example: EXAMPLE_USER },
      userNotFound404,
      identityUnreachable502,
    ],
  },
  {
    operationId: 'createCommunity',
    method: 'post',
    path: '/api/communities',
    summary: 'Create a community (tenant) (proxied)',
    description: 'Registers a community with a unique slug. Idempotent on Idempotency-Key.',
    tags: ['identity'],
    mutating: true,
    params: [idempotencyKeyHeaderParam],
    requestBodyRef: 'CreateCommunityRequest',
    requestExample: { slug: EXAMPLE_COMMUNITY.slug, name: EXAMPLE_COMMUNITY.name },
    responses: [
      {
        code: 201,
        description: 'The created community.',
        bodyRef: 'Community',
        example: EXAMPLE_COMMUNITY,
        links: {
          AddFirstMember: {
            operationId: 'addMembership',
            parameters: { communityId: '$response.body#/id' },
            description: 'Add a member (e.g. the owner) to the community.',
          },
          ListCommunityMembers: {
            operationId: 'listMembers',
            parameters: { communityId: '$response.body#/id' },
            description: 'List the community’s members.',
          },
        },
      },
      slugConflict409,
      identityUnreachable502,
    ],
  },
  {
    operationId: 'addMembership',
    method: 'post',
    path: '/api/communities/{communityId}/members',
    summary: 'Add a member to a community (proxied)',
    description: 'Grants a user a role (owner/moderator/member). Idempotent on Idempotency-Key.',
    tags: ['identity'],
    mutating: true,
    params: [communityIdParam, idempotencyKeyHeaderParam],
    requestBodyRef: 'AddMembershipRequest',
    requestExample: { user_id: EXAMPLE_USER_ID, role: EXAMPLE_MEMBERSHIP.role },
    responses: [
      {
        code: 201,
        description: 'The created membership.',
        bodyRef: 'Membership',
        example: EXAMPLE_MEMBERSHIP,
        links: {
          ListMembers: {
            operationId: 'listMembers',
            parameters: { communityId: '$response.body#/community_id' },
            description: 'List the community’s members.',
          },
        },
      },
      membershipConflict409,
      identityUnreachable502,
    ],
  },
  {
    operationId: 'listMembers',
    method: 'get',
    path: '/api/communities/{communityId}/members',
    summary: 'List a community’s members (proxied)',
    description: 'Returns the community’s memberships, newest first, with a read envelope.',
    tags: ['identity'],
    mutating: false,
    params: [communityIdParam],
    responses: [
      {
        code: 200,
        description: 'The community’s members.',
        bodyRef: 'MemberList',
        example: {
          community_id: EXAMPLE_COMMUNITY_ID,
          members: [EXAMPLE_MEMBERSHIP],
          as_of: EXAMPLE_AS_OF,
        },
      },
      identityUnreachable502,
    ],
  },
  {
    operationId: 'createSession',
    method: 'post',
    path: '/api/sessions',
    summary: 'Issue an access token for a user (proxied)',
    description:
      'Issues an ES256 JWT carrying the user’s memberships. Idempotent on Idempotency-Key. No credentials are checked (ADR-0022) — this is a demo identity boundary.',
    tags: ['identity'],
    mutating: true,
    params: [idempotencyKeyHeaderParam],
    requestBodyRef: 'CreateSessionRequest',
    requestExample: { user_id: EXAMPLE_USER_ID },
    responses: [
      {
        code: 201,
        description: 'The issued access token.',
        bodyRef: 'AccessTokenResponse',
        example: {
          session_id: EXAMPLE_SESSION_ID,
          access_token: 'eyJhbGciOiJFUzI1NiIsImtpZCI6Imtl…',
          token_type: 'Bearer',
          expires_at: EXAMPLE_WHEN,
          kid: EXAMPLE_KEY_ID,
        },
        links: {
          MintWsTicket: {
            operationId: 'createWsTicket',
            description: 'Mint a WebSocket handshake ticket with this access token.',
          },
        },
      },
      userNotFound404,
      identityUnreachable502,
    ],
  },
  {
    operationId: 'createWsTicket',
    method: 'post',
    path: '/ws/tickets',
    summary: 'Mint a one-use WebSocket handshake ticket (proxied)',
    description:
      'Mints a short-lived (≤30s), one-use ticket for the bearer principal (ADR-0013). Forwarded to identity-service, which verifies the JWT. Deliberately NOT idempotent: each call mints a fresh ticket.',
    tags: ['identity'],
    mutating: true,
    params: [authorizationHeaderParam],
    responses: [
      {
        code: 201,
        description: 'The minted ticket and its lifetime.',
        bodyRef: 'TicketResponse',
        example: { ticket: EXAMPLE_TICKET_ID, expires_in_seconds: 30 },
        links: {
          PollEvents: {
            operationId: 'listEvents',
            description: 'The polling fallback that mirrors the WebSocket stream (Commitment 11).',
          },
        },
      },
      wsTicketUnauthorized401,
      identityUnreachable502,
    ],
  },
]

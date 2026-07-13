import {
  communityIdParam,
  EXAMPLE_COMMUNITY,
  EXAMPLE_COMMUNITY_ID,
  EXAMPLE_JWK,
  EXAMPLE_KEY_ID,
  EXAMPLE_MEMBERSHIP,
  EXAMPLE_SESSION_ID,
  EXAMPLE_USER,
  EXAMPLE_USER_ID,
  EXAMPLE_WHEN,
  idempotencyConflict,
  idempotencyKeyHeaderParam,
  type OasOperation,
  problemResponse,
  SYSTEM_OPERATIONS,
  userIdParam,
  validationFailed,
} from '@qaroom/contracts'

/**
 * The canonical operation registry for identity-service. Single source feeding the
 * committed `openapi.yaml`, the `/system/capabilities` response, and the capabilities
 * completeness test. Routes are wired by hand but MUST stay in lockstep with this list.
 *
 * Note the failure-domain choices: a read/write naming a non-existent community is a
 * `tenant_resolution` failure (identity is the registry — Commitment 9), distinct from a
 * missing user, which is plain `not_found`.
 */
const validation400 = validationFailed(
  'The request body or headers failed validation.',
  `/api/users/${EXAMPLE_USER_ID}`,
)
const userNotFound = problemResponse(404, 'user-not-found', 'User not found', 'not_found', {
  description: 'No user with that id exists.',
  instance: `/api/users/${EXAMPLE_USER_ID}`,
})
const communityNotFound = problemResponse(
  404,
  'community-not-found',
  'Community not found',
  'tenant_resolution',
  {
    description: 'No community with that id exists.',
    instance: `/api/communities/${EXAMPLE_COMMUNITY_ID}/members`,
  },
)
const slugConflict = problemResponse(
  409,
  'community-slug-taken',
  'Community slug already taken',
  'conflict',
  { description: 'A community with that slug already exists.', instance: '/api/communities' },
)
const membershipConflict = problemResponse(
  409,
  'membership-exists',
  'Membership already exists',
  'conflict',
  {
    description: 'That user already belongs to the community.',
    instance: `/api/communities/${EXAMPLE_COMMUNITY_ID}/members`,
  },
)

// Undocumented-409 fuzz finding (gauntlet phase 6, live identity, Schemathesis seed
// 6206237401687615594460301199776970265): the shared idempotency middleware answers a reused
// Idempotency-Key with a different body as 409 on EVERY mutating endpoint — identity's registry
// originally never declared it. Now sourced from the shared @qaroom/contracts factory; identity
// passes its own example `instance`.
const idempotencyConflict409 = idempotencyConflict('/api/users')

const EXAMPLE_ACCESS_TOKEN = {
  session_id: EXAMPLE_SESSION_ID,
  access_token: 'eyJhbGciOiJFUzI1NiIsImtpZCI6ImtleV8wMSJ9.eyJzdWIiOiJ1c2VyXzAxIn0.sig',
  token_type: 'Bearer',
  expires_at: EXAMPLE_WHEN,
  kid: EXAMPLE_KEY_ID,
}

// WebSocket-ticket auth (Milestone 5, ADR-0013).
const ticketUnauthorized = problemResponse(
  401,
  'missing-bearer-token',
  'Authentication failed',
  'authentication',
  { description: 'A valid Bearer access token is required.', instance: '/ws/tickets' },
)
const ticketInvalid = problemResponse(
  401,
  'ticket-invalid',
  'Authentication failed',
  'authentication',
  {
    description: 'The ticket is unknown, expired, or already redeemed.',
    instance: '/ws/tickets/redeem',
  },
)
const authHeaderParam = {
  name: 'Authorization',
  in: 'header' as const,
  required: true,
  description: 'Bearer access token (the JWT minted by createSession).',
  schema: { type: 'string', pattern: '^Bearer .+$' },
}
const EXAMPLE_TICKET = { ticket: 'tkt_01HZY0K7M3QF8VN2J5RX9TB4CK', expires_in_seconds: 30 }

export const OPERATIONS: readonly OasOperation[] = [
  {
    operationId: 'createUser',
    method: 'post',
    path: '/api/users',
    summary: 'Create a user',
    description: 'Creates a user identity. Idempotent on the Idempotency-Key header.',
    tags: ['users'],
    mutating: true,
    params: [idempotencyKeyHeaderParam],
    requestBodyRef: 'CreateUserRequest',
    requestExample: { handle: EXAMPLE_USER.handle, display_name: EXAMPLE_USER.display_name },
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
      validation400,
      idempotencyConflict409,
    ],
  },
  {
    operationId: 'getUser',
    method: 'get',
    path: '/api/users/{userId}',
    summary: 'Get a single user',
    description: 'Returns a user identity by id.',
    tags: ['users'],
    mutating: false,
    params: [userIdParam],
    responses: [
      { code: 200, description: 'The user.', bodyRef: 'User', example: EXAMPLE_USER },
      validation400,
      userNotFound,
    ],
  },
  {
    operationId: 'deleteUser',
    method: 'delete',
    path: '/api/users/{userId}',
    summary: 'Erase a user (GDPR right-to-erasure)',
    description:
      'Erases a user across the platform. Identity deletes its own user data and stages one `user.erased` event per community the user belonged to; content- and donations-service consume those and delete their slice. Orchestrated as the erasure saga (ADR-0036); returns 202 Accepted because the cross-service cascade settles asynchronously. Idempotent on the Idempotency-Key header.',
    tags: ['users'],
    mutating: true,
    params: [userIdParam, idempotencyKeyHeaderParam],
    responses: [
      {
        code: 202,
        description: 'The erasure was accepted; the cross-service cascade is in progress.',
        bodyRef: 'UserErasureAccepted',
        example: {
          saga_id: 'erasure_01HZY0K7M3QF8VN2J5RX9TB4CG',
          user_id: EXAMPLE_USER_ID,
          status: 'Cascading',
          communities: [EXAMPLE_COMMUNITY_ID],
        },
        links: {
          GetErasedUser: {
            operationId: 'getUser',
            parameters: { userId: '$response.body#/user_id' },
            description:
              'Fetch the erased user — once the saga settles it returns 404, the erasure made observable.',
          },
        },
      },
      validation400,
      userNotFound,
      idempotencyConflict409,
    ],
  },
  {
    operationId: 'createCommunity',
    method: 'post',
    path: '/api/communities',
    summary: 'Create a community (tenant)',
    description: 'Creates a community. Idempotent on Idempotency-Key; the slug must be unique.',
    tags: ['communities'],
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
          ListCommunityMembers: {
            operationId: 'listMembers',
            parameters: { communityId: '$response.body#/id' },
            description: 'List the members of the community that was just created.',
          },
        },
      },
      validation400,
      slugConflict,
      idempotencyConflict409,
    ],
  },
  {
    operationId: 'addMembership',
    method: 'post',
    path: '/api/communities/{communityId}/members',
    summary: 'Add a member to a community',
    description: 'Grants a user a role in a community. Idempotent on Idempotency-Key.',
    tags: ['communities'],
    mutating: true,
    params: [communityIdParam, idempotencyKeyHeaderParam],
    requestBodyRef: 'AddMembershipRequest',
    requestExample: { user_id: EXAMPLE_USER_ID, role: 'member' },
    responses: [
      {
        code: 201,
        description: 'The created membership.',
        bodyRef: 'Membership',
        example: EXAMPLE_MEMBERSHIP,
        links: {
          ListCommunityMembers: {
            operationId: 'listMembers',
            parameters: { communityId: '$response.body#/community_id' },
            description: 'List the community members after adding one.',
          },
        },
      },
      validation400,
      communityNotFound,
      membershipConflict,
      idempotencyConflict409,
    ],
  },
  {
    operationId: 'listMembers',
    method: 'get',
    path: '/api/communities/{communityId}/members',
    summary: 'List a community’s members',
    description:
      'Returns the members of a community, newest first, with a read consistency envelope.',
    tags: ['communities'],
    mutating: false,
    params: [communityIdParam],
    responses: [
      { code: 200, description: 'The community members.', bodyRef: 'MemberList' },
      validation400,
      communityNotFound,
    ],
  },
  {
    operationId: 'createSession',
    method: 'post',
    path: '/api/sessions',
    summary: 'Create a session (issue an access token)',
    description:
      'Issues a short-lived ES256 access token for a user. Idempotent on Idempotency-Key.',
    tags: ['sessions'],
    mutating: true,
    params: [idempotencyKeyHeaderParam],
    requestBodyRef: 'CreateSessionRequest',
    requestExample: { user_id: EXAMPLE_USER_ID },
    responses: [
      {
        code: 201,
        description: 'The issued access token.',
        bodyRef: 'AccessTokenResponse',
        example: EXAMPLE_ACCESS_TOKEN,
        links: {
          FetchJwks: {
            operationId: 'getJwks',
            description: 'Fetch the JWKS to verify the issued token’s signature.',
          },
        },
      },
      validation400,
      userNotFound,
      idempotencyConflict409,
    ],
  },
  {
    operationId: 'createWsTicket',
    method: 'post',
    path: '/ws/tickets',
    summary: 'Mint a one-use WebSocket handshake ticket',
    description:
      'Issues a one-use, 30-second ticket bound to the authenticated principal. Present it in the WebSocket subprotocol (`ticket.<ticket>`). Deliberately not idempotent — each call mints a fresh ticket (ADR-0013).',
    tags: ['ws'],
    mutating: false,
    params: [authHeaderParam],
    responses: [
      {
        code: 201,
        description: 'A freshly minted ticket.',
        bodyRef: 'TicketResponse',
        example: EXAMPLE_TICKET,
      },
      ticketUnauthorized,
    ],
  },
  {
    operationId: 'redeemWsTicket',
    method: 'post',
    path: '/ws/tickets/redeem',
    summary: 'Redeem a WebSocket ticket (internal, gateway → identity)',
    description:
      'Consumes a ticket exactly once and returns the principal it authorizes. Called by the gateway before upgrading a WebSocket connection. An unknown, expired, or already-redeemed ticket is a 401.',
    tags: ['ws'],
    mutating: false,
    requestBodyRef: 'RedeemTicketRequest',
    requestExample: { ticket: 'tkt_01HZY0K7M3QF8VN2J5RX9TB4CK' },
    responses: [
      {
        code: 200,
        description: 'The principal the ticket authorizes.',
        bodyRef: 'RedeemTicketResponse',
        example: {
          user_id: EXAMPLE_USER_ID,
          memberships: [{ community_id: EXAMPLE_COMMUNITY_ID, role: 'member' }],
        },
      },
      // Undocumented-400 fuzz finding (gauntlet phase 6): the strict body schema rejects unknown
      // properties as a validation 400, which the spec never declared (200/401 only).
      validation400,
      ticketInvalid,
    ],
  },
  {
    operationId: 'getJwks',
    method: 'get',
    path: '/jwks.json',
    summary: 'JSON Web Key Set',
    description:
      'Returns the JWKS-eligible public keys (current plus in-grace previous keys) for ES256 verification.',
    tags: ['jwks'],
    mutating: false,
    responses: [
      { code: 200, description: 'The JWKS.', bodyRef: 'Jwks', example: { keys: [EXAMPLE_JWK] } },
    ],
  },
  // The /system/state + /system/capabilities pair every service exposes identically (Commitment 7),
  // sourced from the shared @qaroom/contracts registry so drift is guarded centrally.
  ...SYSTEM_OPERATIONS,
]

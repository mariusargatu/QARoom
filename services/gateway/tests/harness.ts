import {
  ACCESS_TOKEN_ISSUER,
  AccessTokenClaims,
  EXAMPLE_COMMUNITY_ID,
  EXAMPLE_POST_ID,
  EXAMPLE_USER_ID,
  type RedeemTicketResponse,
} from '@qaroom/contracts'
import { problem } from '@qaroom/service-kit'
import { createSeededDeps, injectClient } from '@qaroom/testing-utils/harness'
import { buildGatewayApp } from '../src/app'
import type { ClientResponse, ContentClient } from '../src/clients/content-client'
import type { DonationsClient } from '../src/clients/donations-client'
import type { FlagsClient } from '../src/clients/flags-client'
import type { IdentityClient } from '../src/clients/identity-client'
import type { ModeratorClient } from '../src/clients/moderator-client'
import type { TicketClient } from '../src/clients/ticket-client'
import type { WebhooksClient } from '../src/clients/webhooks-client'
import { CommunityEventStream } from '../src/event-stream'
import type { RateLimitConfig } from '../src/resilience/rate-limiter'
import type { TokenVerifier } from '../src/token-verifier'

export interface GatewayTestOptions {
  rateLimit?: RateLimitConfig
  authRateLimit?: RateLimitConfig
  tickets?: TicketClient
  verifyToken?: TokenVerifier
  eventStream?: CommunityEventStream
  donations?: DonationsClient
  flags?: FlagsClient
  webhooks?: WebhooksClient
  identity?: IdentityClient
  moderator?: ModeratorClient
}

/** Build the gateway with injected stub clients + seeded determinism. */
export function setupGatewayTest(content: ContentClient, options: GatewayTestOptions = {}) {
  const deps = createSeededDeps()
  const eventStream = options.eventStream ?? new CommunityEventStream()
  const app = buildGatewayApp({
    content,
    donations: options.donations,
    flags: options.flags,
    webhooks: options.webhooks,
    identity: options.identity,
    moderator: options.moderator,
    tickets: options.tickets ?? noTickets(),
    verifyToken: options.verifyToken ?? tokenVerifierStub({ [MEMBER_TOKEN]: sampleMemberClaims() }),
    clock: deps.clock,
    ids: deps.ids,
    randomness: deps.randomness,
    rateLimit: options.rateLimit,
    authRateLimit: options.authRateLimit,
    eventStream,
  })
  return { ...deps, app, eventStream, request: injectClient(app) }
}

/**
 * One factory for every upstream-client double. A client stub is just "these method names, each
 * returning the same response" (constant) or "each throwing a transport error" (unreachable) — so
 * the per-client `getFeed/getPost/...` object literals (×10, the audit's dedup target) collapse to a
 * method-name tuple + this builder. The cast is sound: a no-arg `reply` is assignable to each
 * arg-taking method (fewer params), and the tuple covers exactly the client's interface keys.
 */
function constantClient<T>(methods: readonly string[], response: ClientResponse): T {
  const reply = async () => response
  return Object.fromEntries(methods.map((m) => [m, reply])) as unknown as T
}

function unreachableClient<T>(methods: readonly string[]): T {
  const fail = async (): Promise<ClientResponse> => {
    throw new Error('ECONNREFUSED')
  }
  return Object.fromEntries(methods.map((m) => [m, fail])) as unknown as T
}

/** One upstream call as the route made it: which client method, and the arguments it passed. */
export interface CapturedCall {
  method: string
  args: unknown[]
}

/**
 * A client double that records the ARGUMENTS each call receives.
 *
 * `constantClient` and `recordingClient` both ignore their arguments entirely, so nothing anywhere
 * asserted what a route actually forwards upstream. That left the whole chain route → client args →
 * wire body without an oracle: the pact's request body is hand-written inside the pact test rather
 * than produced by driving the route, so a route that dropped or renamed a field would satisfy the
 * route tests (stub ignores args), the consumer pact (body written by hand), and provider
 * verification (which replays that same hand-written body). See `pact-forwarding.spec.ts`.
 */
function capturingClient<T>(
  methods: readonly string[],
  response: ClientResponse,
): { client: T; calls: CapturedCall[] } {
  const calls: CapturedCall[] = []
  const entries = methods.map((method) => [
    method,
    async (...args: unknown[]) => {
      calls.push({ method, args })
      return response
    },
  ])
  return { client: Object.fromEntries(entries) as unknown as T, calls }
}

/** A content client that records every call's arguments, plus the shared `calls` log. */
export const capturingContent = (
  response: ClientResponse,
): { client: ContentClient; calls: CapturedCall[] } =>
  capturingClient<ContentClient>(CONTENT_METHODS, response)

/**
 * Unlike `constantClient` (one reply for every method — which HIDES a route→method miswire), a
 * recording client tags each method's response body with that method's own name. A route that
 * binds to the WRONG client method then returns the wrong tag, so a per-route assertion that the
 * body carries the EXPECTED method name catches the miswire. 200 keeps every reply a pass-through.
 */
function recordingClient<T>(methods: readonly string[]): T {
  const tagged = (m: string) => async (): Promise<ClientResponse> => ({
    status: 200,
    body: { calledMethod: m },
    contentType: 'application/json',
  })
  return Object.fromEntries(methods.map((m) => [m, tagged(m)])) as unknown as T
}

const CONTENT_METHODS = ['getFeed', 'getPost', 'createPost', 'castVote'] as const
const DONATIONS_METHODS = ['listDonations', 'getDonation', 'createDonation'] as const
const FLAGS_METHODS = ['resolveFlag', 'listFlags', 'advanceRollout'] as const
const IDENTITY_METHODS = [
  'createUser',
  'getUser',
  'createCommunity',
  'addMembership',
  'listMembers',
  'createSession',
  'createWsTicket',
] as const
const MODERATOR_METHODS = ['listDecisions', 'getDecision'] as const
const WEBHOOKS_METHODS = [
  'createWebhook',
  'listWebhooks',
  'getWebhook',
  'deleteWebhook',
  'pauseWebhook',
  'resumeWebhook',
  'listWebhookDeliveries',
] as const

/** A content stub that returns the same response for every call. */
export const constantContent = (response: ClientResponse): ContentClient =>
  constantClient<ContentClient>(CONTENT_METHODS, response)
/** A content stub that simulates an unreachable upstream (every call throws). */
export const unreachableContent = (): ContentClient =>
  unreachableClient<ContentClient>(CONTENT_METHODS)

/** A donations stub returning the same response for every call. */
export const constantDonations = (response: ClientResponse): DonationsClient =>
  constantClient<DonationsClient>(DONATIONS_METHODS, response)
/** A donations stub whose every call throws (unreachable / timed-out / circuit open). */
export const unreachableDonations = (): DonationsClient =>
  unreachableClient<DonationsClient>(DONATIONS_METHODS)

/** A flags stub returning the same response for every call. */
export const constantFlags = (response: ClientResponse): FlagsClient =>
  constantClient<FlagsClient>(FLAGS_METHODS, response)
/** A flags stub whose every call throws (unreachable / timed-out). */
export const unreachableFlags = (): FlagsClient => unreachableClient<FlagsClient>(FLAGS_METHODS)

/** An identity stub returning the same response for every call. */
export const constantIdentity = (response: ClientResponse): IdentityClient =>
  constantClient<IdentityClient>(IDENTITY_METHODS, response)
/** An identity stub whose every call throws (unreachable / timed-out). */
export const unreachableIdentity = (): IdentityClient =>
  unreachableClient<IdentityClient>(IDENTITY_METHODS)

/** A moderator stub returning the same response for every call. */
export const constantModerator = (response: ClientResponse): ModeratorClient =>
  constantClient<ModeratorClient>(MODERATOR_METHODS, response)
/** A moderator stub whose every call throws (unreachable / timed-out). */
export const unreachableModerator = (): ModeratorClient =>
  unreachableClient<ModeratorClient>(MODERATOR_METHODS)

/** A webhooks stub returning the same response for every call. */
export const constantWebhooks = (response: ClientResponse): WebhooksClient =>
  constantClient<WebhooksClient>(WEBHOOKS_METHODS, response)
/** A webhooks stub whose every call throws (unreachable / timed-out). */
export const unreachableWebhooks = (): WebhooksClient =>
  unreachableClient<WebhooksClient>(WEBHOOKS_METHODS)

/** Method-tagging stubs (each reply carries `calledMethod`) — for route→method wiring assertions. */
export const recordingContent = (): ContentClient => recordingClient<ContentClient>(CONTENT_METHODS)
export const recordingDonations = (): DonationsClient =>
  recordingClient<DonationsClient>(DONATIONS_METHODS)
export const recordingFlags = (): FlagsClient => recordingClient<FlagsClient>(FLAGS_METHODS)
export const recordingIdentity = (): IdentityClient =>
  recordingClient<IdentityClient>(IDENTITY_METHODS)
export const recordingModerator = (): ModeratorClient =>
  recordingClient<ModeratorClient>(MODERATOR_METHODS)
export const recordingWebhooks = (): WebhooksClient =>
  recordingClient<WebhooksClient>(WEBHOOKS_METHODS)

/** A ticket client that never recognizes any ticket (the default — no valid tickets). */
export function noTickets(): TicketClient {
  return { redeem: async () => null }
}

/** A ticket client that redeems exactly the given tickets once each (mirrors identity's one-use store). */
export function ticketStub(valid: Record<string, RedeemTicketResponse>): TicketClient {
  const remaining = new Map(Object.entries(valid))
  return {
    redeem: async (ticket) => {
      const principal = remaining.get(ticket)
      if (!principal) return null
      remaining.delete(ticket)
      return principal
    },
  }
}

export const SAMPLE = {
  community: EXAMPLE_COMMUNITY_ID,
  communityOther: 'comm_01HZY0K7M3QF8VN2J5RX9TB4CE',
  post: EXAMPLE_POST_ID,
  user: EXAMPLE_USER_ID,
} as const

/** A bearer token the default verifier accepts: a member of SAMPLE.community only. */
export const MEMBER_TOKEN = 'tok_member'

/** Decoded claims for MEMBER_TOKEN — a member of SAMPLE.community, nothing else. */
export function sampleMemberClaims(): AccessTokenClaims {
  return AccessTokenClaims.parse({
    sub: EXAMPLE_USER_ID,
    iss: ACCESS_TOKEN_ISSUER,
    iat: 0,
    exp: 9_999_999_999,
    memberships: [{ community_id: EXAMPLE_COMMUNITY_ID, role: 'member' }],
  })
}

/**
 * A TokenVerifier double: maps a bearer token to its decoded claims (the crypto lives in the real
 * token-verifier, unit-tested separately against jose). An unknown/missing token throws the same
 * RFC 7807 401 the real verifier does, so route-level 401 handling is exercised honestly.
 */
export function tokenVerifierStub(byToken: Record<string, AccessTokenClaims>): TokenVerifier {
  return {
    verify: async (authorization) => {
      const token = authorization?.match(/^Bearer (.+)$/)?.[1]
      const claims = token ? byToken[token] : undefined
      if (!claims) {
        throw problem({
          slug: 'token-invalid',
          title: 'Authentication failed',
          status: 401,
          failure_domain: 'authentication',
          detail: 'stub verifier: unknown or missing bearer token',
          retryable: false,
        })
      }
      return claims
    },
  }
}

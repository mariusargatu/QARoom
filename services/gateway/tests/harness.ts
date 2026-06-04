import {
  EXAMPLE_COMMUNITY_ID,
  EXAMPLE_POST_ID,
  EXAMPLE_USER_ID,
  type RedeemTicketResponse,
} from '@qaroom/contracts'
import { createSeededDeps, injectClient } from '@qaroom/testing-utils/harness'
import { buildGatewayApp } from '../src/app'
import type { ClientResponse, ContentClient } from '../src/content-client'
import { CommunityEventStream } from '../src/event-stream'
import type { RateLimitConfig } from '../src/rate-limiter'
import type { TicketClient } from '../src/ticket-client'

export interface GatewayTestOptions {
  rateLimit?: RateLimitConfig
  tickets?: TicketClient
  eventStream?: CommunityEventStream
}

/** Build the gateway with injected stub clients + seeded determinism. */
export function setupGatewayTest(content: ContentClient, options: GatewayTestOptions = {}) {
  const deps = createSeededDeps()
  const eventStream = options.eventStream ?? new CommunityEventStream()
  const app = buildGatewayApp({
    content,
    tickets: options.tickets ?? noTickets(),
    clock: deps.clock,
    ids: deps.ids,
    randomness: deps.randomness,
    rateLimit: options.rateLimit,
    eventStream,
  })
  return { ...deps, app, eventStream, request: injectClient(app) }
}

/** A content stub that returns the same response for every call. */
export function constantContent(response: ClientResponse): ContentClient {
  const reply = async () => response
  return { getFeed: reply, getPost: reply, createPost: reply, castVote: reply }
}

/** A content stub that simulates an unreachable upstream (every call throws). */
export function unreachableContent(): ContentClient {
  const fail = async (): Promise<ClientResponse> => {
    throw new Error('ECONNREFUSED')
  }
  return { getFeed: fail, getPost: fail, createPost: fail, castVote: fail }
}

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

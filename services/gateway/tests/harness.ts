import {
  EXAMPLE_COMMUNITY_ID,
  EXAMPLE_POST_ID,
  EXAMPLE_USER_ID,
  type RedeemTicketResponse,
} from '@qaroom/contracts'
import { createSeededDeps, injectClient } from '@qaroom/testing-utils/harness'
import { buildGatewayApp } from '../src/app'
import type { ClientResponse, ContentClient } from '../src/content-client'
import type { DonationsClient } from '../src/donations-client'
import { CommunityEventStream } from '../src/event-stream'
import type { FlagsClient } from '../src/flags-client'
import type { IdentityClient } from '../src/identity-client'
import type { ModeratorClient } from '../src/moderator-client'
import type { RateLimitConfig } from '../src/rate-limiter'
import type { TicketClient } from '../src/ticket-client'

export interface GatewayTestOptions {
  rateLimit?: RateLimitConfig
  tickets?: TicketClient
  eventStream?: CommunityEventStream
  donations?: DonationsClient
  flags?: FlagsClient
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
    identity: options.identity,
    moderator: options.moderator,
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

/** A donations stub returning the same response for every call. */
export function constantDonations(response: ClientResponse): DonationsClient {
  const reply = async () => response
  return { listDonations: reply, getDonation: reply, createDonation: reply }
}

/** A donations stub whose every call throws (unreachable / timed-out / circuit open). */
export function unreachableDonations(): DonationsClient {
  const fail = async (): Promise<ClientResponse> => {
    throw new Error('ECONNREFUSED')
  }
  return { listDonations: fail, getDonation: fail, createDonation: fail }
}

/** A flags stub returning the same response for every call. */
export function constantFlags(response: ClientResponse): FlagsClient {
  const reply = async () => response
  return { resolveFlag: reply, listFlags: reply, advanceRollout: reply }
}

/** A flags stub whose every call throws (unreachable / timed-out). */
export function unreachableFlags(): FlagsClient {
  const fail = async (): Promise<ClientResponse> => {
    throw new Error('ECONNREFUSED')
  }
  return { resolveFlag: fail, listFlags: fail, advanceRollout: fail }
}

/** An identity stub returning the same response for every call. */
export function constantIdentity(response: ClientResponse): IdentityClient {
  const reply = async () => response
  return {
    createUser: reply,
    getUser: reply,
    createCommunity: reply,
    addMembership: reply,
    listMembers: reply,
    createSession: reply,
    createWsTicket: reply,
  }
}

/** An identity stub whose every call throws (unreachable / timed-out). */
export function unreachableIdentity(): IdentityClient {
  const fail = async (): Promise<ClientResponse> => {
    throw new Error('ECONNREFUSED')
  }
  return {
    createUser: fail,
    getUser: fail,
    createCommunity: fail,
    addMembership: fail,
    listMembers: fail,
    createSession: fail,
    createWsTicket: fail,
  }
}

/** A moderator stub returning the same response for every call. */
export function constantModerator(response: ClientResponse): ModeratorClient {
  const reply = async () => response
  return { listDecisions: reply, getDecision: reply }
}

/** A moderator stub whose every call throws (unreachable / timed-out). */
export function unreachableModerator(): ModeratorClient {
  const fail = async (): Promise<ClientResponse> => {
    throw new Error('ECONNREFUSED')
  }
  return { listDecisions: fail, getDecision: fail }
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

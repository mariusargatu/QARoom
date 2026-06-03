import { EXAMPLE_COMMUNITY_ID, EXAMPLE_POST_ID, EXAMPLE_USER_ID } from '@qaroom/contracts'
import { createSeededDeps, injectClient } from '@qaroom/testing-utils/harness'
import { buildGatewayApp } from '../src/app'
import type { ClientResponse, ContentClient } from '../src/content-client'
import type { RateLimitConfig } from '../src/rate-limiter'

export interface GatewayTestOptions {
  rateLimit?: RateLimitConfig
}

/** Build the gateway with an injected (stub) content client + seeded determinism. */
export function setupGatewayTest(content: ContentClient, options: GatewayTestOptions = {}) {
  const deps = createSeededDeps()
  const app = buildGatewayApp({
    content,
    clock: deps.clock,
    ids: deps.ids,
    randomness: deps.randomness,
    rateLimit: options.rateLimit,
  })
  return { ...deps, app, request: injectClient(app) }
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

export const SAMPLE = {
  community: EXAMPLE_COMMUNITY_ID,
  post: EXAMPLE_POST_ID,
  user: EXAMPLE_USER_ID,
} as const

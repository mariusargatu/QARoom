import type { LamportGate, SpanAttributeSink } from '@qaroom/contracts'
import type { Clock, IdGenerator, Randomness } from '@qaroom/determinism'
import type { ContentClient } from './content-client'
import type { CommunityEventStream } from './event-stream'
import type { RateLimitConfig, RateLimiter } from './rate-limiter'
import type { TicketClient } from './ticket-client'

/** What `buildGatewayApp` receives. `lamport`/`rateLimit`/`eventStream` optional with defaults. */
export interface GatewayDeps {
  content: ContentClient
  /** Redeems WebSocket tickets against identity-service (ADR-0013). */
  tickets: TicketClient
  clock: Clock
  ids: IdGenerator
  randomness: Randomness
  lamport?: LamportGate
  rateLimit?: RateLimitConfig
  /** The push/poll buffer; tests pass their own so they can publish to it directly. */
  eventStream?: CommunityEventStream
  /** Span-attribute sink for the LamportGate; defaults to the active-span bridge (Milestone 3). */
  sink?: SpanAttributeSink
}

/** What route handlers receive: every dependency resolved, including the limiter. */
export interface GatewayRouteDeps {
  content: ContentClient
  tickets: TicketClient
  clock: Clock
  ids: IdGenerator
  randomness: Randomness
  lamport: LamportGate
  limiter: RateLimiter
  eventStream: CommunityEventStream
}

/** Generous default so non-rate-limit tests and normal traffic never trip the limit. */
export const DEFAULT_RATE_LIMIT: RateLimitConfig = { capacity: 600, refillPerSec: 10 }

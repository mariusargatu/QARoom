import type { LamportGate, SpanAttributeSink } from '@qaroom/contracts'
import type { Clock, IdGenerator, Randomness } from '@qaroom/determinism'
import type { ContentClient } from './content-client'
import type { RateLimitConfig, RateLimiter } from './rate-limiter'

/** What `buildGatewayApp` receives. `lamport` + `rateLimit` optional with defaults. */
export interface GatewayDeps {
  content: ContentClient
  clock: Clock
  ids: IdGenerator
  randomness: Randomness
  lamport?: LamportGate
  rateLimit?: RateLimitConfig
  /** Span-attribute sink for the LamportGate; defaults to the active-span bridge (Milestone 3). */
  sink?: SpanAttributeSink
}

/** What route handlers receive: every dependency resolved, including the limiter. */
export interface GatewayRouteDeps {
  content: ContentClient
  clock: Clock
  ids: IdGenerator
  randomness: Randomness
  lamport: LamportGate
  limiter: RateLimiter
}

/** Generous default so non-rate-limit tests and normal traffic never trip the limit. */
export const DEFAULT_RATE_LIMIT: RateLimitConfig = { capacity: 600, refillPerSec: 10 }

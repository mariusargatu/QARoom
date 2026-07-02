import type { LamportGate, SpanAttributeSink } from '@qaroom/contracts'
import type { Clock, IdGenerator, Randomness } from '@qaroom/determinism'
import type { ContentClient } from './content-client'
import type { DonationsClient } from './donations-client'
import type { CommunityEventStream } from './event-stream'
import type { FlagsClient } from './flags-client'
import type { IdentityClient } from './identity-client'
import type { ModeratorClient } from './moderator-client'
import type { RateLimitConfig, RateLimiter } from './rate-limiter'
import type { TicketClient } from './ticket-client'
import type { TokenVerifier } from './token-verifier'
import type { WebhooksClient } from './webhooks-client'

/** What `buildGatewayApp` receives. `lamport`/`rateLimit`/`eventStream` optional with defaults. */
export interface GatewayDeps {
  content: ContentClient
  /** donations/flags/webhooks/identity/moderator proxy clients. Omit → those routes are not registered. */
  donations?: DonationsClient
  flags?: FlagsClient
  webhooks?: WebhooksClient
  identity?: IdentityClient
  moderator?: ModeratorClient
  /** Redeems WebSocket tickets against identity-service (ADR-0013). */
  tickets: TicketClient
  /** Verifies bearer access tokens at the REST edge to enforce membership (ADR-0025). Required so
   * the events polling path cannot silently fall open to a cross-tenant read. */
  verifyToken: TokenVerifier
  clock: Clock
  ids: IdGenerator
  randomness: Randomness
  lamport?: LamportGate
  rateLimit?: RateLimitConfig
  /** Tighter brute-force bucket for the credential endpoint (`POST /api/sessions`), separate
   * from the general limiter (OWASP API#2). Defaults to `DEFAULT_AUTH_RATE_LIMIT`. */
  authRateLimit?: RateLimitConfig
  /** The push/poll buffer; tests pass their own so they can publish to it directly. */
  eventStream?: CommunityEventStream
  /** Span-attribute sink for the LamportGate; defaults to the active-span bridge (Milestone 3). */
  sink?: SpanAttributeSink
}

/** What route handlers receive: every dependency resolved, including the limiter. */
export interface GatewayRouteDeps {
  content: ContentClient
  tickets: TicketClient
  verifyToken: TokenVerifier
  clock: Clock
  lamport: LamportGate
  limiter: RateLimiter
  eventStream: CommunityEventStream
}

/** Generous default so non-rate-limit tests and normal traffic never trip the limit. */
export const DEFAULT_RATE_LIMIT: RateLimitConfig = { capacity: 600, refillPerSec: 10 }

/** Tight default for the credential endpoint: a small burst, slow refill — enough for legitimate
 * session issuance, hostile to credential stuffing. Independent of the general limiter. */
export const DEFAULT_AUTH_RATE_LIMIT: RateLimitConfig = { capacity: 10, refillPerSec: 1 }

/** Effectively-unlimited config: the limiter stays wired (429 path + headers intact) but never trips.
 * Used only when GATEWAY_DISABLE_RATE_LIMIT=1 — so schema-fuzzing (Schemathesis) does not drain the
 * tight auth bucket and misread its own 429s as contract violations. Never set in production. */
export const UNLIMITED_RATE_LIMIT: RateLimitConfig = {
  capacity: 1_000_000,
  refillPerSec: 1_000_000,
}

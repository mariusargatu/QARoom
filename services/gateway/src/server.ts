import { connectNats } from '@qaroom/messaging'
import { createProductionDeps, intFromEnv, runServer } from '@qaroom/service-kit'
import { buildGatewayApp } from './app'
import { createContentClient } from './clients/content-client'
import { createDonationsClient } from './clients/donations-client'
import { createFlagsClient } from './clients/flags-client'
import { createIdentityClient } from './clients/identity-client'
import { createJwksClient } from './clients/jwks-client'
import { createModeratorClient } from './clients/moderator-client'
import { createTicketClient } from './clients/ticket-client'
import { createWebhooksClient } from './clients/webhooks-client'
import { UNLIMITED_RATE_LIMIT } from './deps'
import { startWsFeed } from './event-consumer'
import { CommunityEventStream } from './event-stream'
import { CircuitBreaker } from './resilience/circuit-breaker'
import { upstreamTimeoutMs } from './resilience/upstream-call'
import { createTokenVerifier } from './token-verifier'

const contentBaseUrl = process.env.CONTENT_BASE_URL ?? 'http://localhost:8081'
const identityBaseUrl = process.env.IDENTITY_BASE_URL ?? 'http://localhost:8082'
const donationsBaseUrl = process.env.DONATIONS_BASE_URL ?? 'http://localhost:8084'
const flagsBaseUrl = process.env.FLAGS_BASE_URL ?? 'http://localhost:8083'
const webhooksBaseUrl = process.env.WEBHOOKS_BASE_URL ?? 'http://localhost:8087'
const moderatorBaseUrl = process.env.MODERATOR_AGENT_BASE_URL ?? 'http://localhost:8086'
const natsUrl = process.env.NATS_URL ?? 'nats://localhost:4222'
const port = intFromEnv('PORT', 8080)

const BREAKER_THRESHOLD = 5
const BREAKER_COOLDOWN_MS = 5000

runServer(
  async () => {
    const eventStream = new CommunityEventStream()
    // Feed the WS/poll stream from JetStream flag/donation events (integration surface).
    const nats = await connectNats(natsUrl)
    await startWsFeed(nats, eventStream)
    const deps = createProductionDeps()
    const timeoutMs = upstreamTimeoutMs()
    // The donations circuit breaker is the experiment-06 mitigation. CHAOS_DISABLE_CIRCUIT_BREAKER=1
    // omits it so the deliberate-bug demo can show raw provider 5xx leaking through the gateway.
    // Strict === '1' like every other toggle read site: '0'/'false' must NOT disable the breaker.
    const breaker =
      process.env.CHAOS_DISABLE_CIRCUIT_BREAKER === '1'
        ? undefined
        : new CircuitBreaker(deps.clock, deps.randomness, {
            threshold: BREAKER_THRESHOLD,
            cooldownMs: BREAKER_COOLDOWN_MS,
          })
    // GATEWAY_DISABLE_RATE_LIMIT=1 lifts BOTH buckets to effectively-unlimited for the schema-fuzz
    // window only (Schemathesis drains the tight auth bucket and misreads its own 429s as contract
    // violations). The limiter stays wired; production never sets it. Strict === '1' like every toggle.
    const rateLimitOverride =
      process.env.GATEWAY_DISABLE_RATE_LIMIT === '1'
        ? { rateLimit: UNLIMITED_RATE_LIMIT, authRateLimit: UNLIMITED_RATE_LIMIT }
        : {}
    return buildGatewayApp({
      ...rateLimitOverride,
      content: createContentClient(contentBaseUrl, { timeoutMs }),
      donations: createDonationsClient(donationsBaseUrl, { timeoutMs, breaker }),
      flags: createFlagsClient(flagsBaseUrl, { timeoutMs }),
      webhooks: createWebhooksClient(webhooksBaseUrl, { timeoutMs }),
      identity: createIdentityClient(identityBaseUrl, { timeoutMs }),
      moderator: createModeratorClient(moderatorBaseUrl, { timeoutMs }),
      tickets: createTicketClient(identityBaseUrl),
      // Edge token verification for REST membership enforcement (ADR-0025): consume identity's JWKS
      // through the bounded-timeout client, verify ES256 locally (no per-poll round-trip).
      verifyToken: createTokenVerifier(
        createJwksClient(identityBaseUrl, { timeoutMs }),
        deps.clock,
      ),
      eventStream,
      ...deps,
    })
  },
  { port, name: 'gateway' },
)

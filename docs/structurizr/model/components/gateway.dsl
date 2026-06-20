# gateway components — the external trust boundary. Proxies every upstream over HTTP, no DB.
# Source: services/gateway/src/*, services/gateway/AGENTS.md.

gRoutes      = component "proxy routes"      "Per-domain Fastify route groups (content, identity, flags, donations, webhooks, moderation reads). Re-validate branded ids + Idempotency-Key at the edge; never trust the caller." "TS"
gRateLimit   = component "rate limiter"      "Per-IP + per X-Principal-Id token bucket. 429 with failure_domain: rate_limit. State is per-process, in-memory." "TS"
gClients     = component "upstream clients"  "Thin HTTP client per upstream (content/identity/flags/donations/webhooks/moderator/tickets) over the bound caller; map upstream faults to 502." "TS"
gUpstream    = component "upstream-call"     "Bounded HTTP caller with AbortSignal timeout (5s default, tunable via GATEWAY_UPSTREAM_TIMEOUT_MS)." "TS"
gBreaker     = component "circuit-breaker"   "Consecutive-failure breaker (threshold 5; cooldown + jitter from injected Randomness; half-open trial). Guards each upstream." "TS"
gWsUpgrade   = component "ws-upgrade"        "/ws upgrade handler. Validates a one-use 30s ticket (Sec-WebSocket-Protocol) against identity before upgrading (ADR-0013)." "TS"
gEventStream = component "event stream"      "NATS consumer + per-community WebSocket feed. Relays flag/donation changes as WsEnvelopes; a polling endpoint serves the same events (Commitment 11)." "TS"
gJwks        = component "jwks client"       "Consumes identity's JWKS contract (Pact-verified). The gateway does NOT enforce JWTs inbound (deliberate, ADR-0022)." "TS"
gOps         = component "operations registry" "Aggregates domain operations into openapi.yaml + /system/capabilities + /system/limits." "TS"

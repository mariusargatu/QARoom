# The QARoom software system: containers (services, datastores, the event backbone), the component
# breakdown of the four most instructive services, and a co-located TESTING perspective on each
# container (the technique(s) + boundary that defend it). Relationships live in relationships.dsl.
#
# Perspectives overlay the testing architecture directly onto the C4 structure: in Structurizr Lite
# each element's "Testing" / "Boundary" perspective is visible on hover and in the element table.
# The standalone testing-architecture diagrams live in views/testing-views.dsl + model/testing.dsl.

qaroom = softwareSystem "QARoom" "A multi-tenant social platform (communities of posts, votes, feature-gated donations, RAG moderation, outbound webhooks) built as a specimen: testability as an architectural property." {

    web = container "web" "React 19 / Vite 7 SPA. Atomic-design component library; WS feed with polling parity; drives the SAME XState rollout machine the server does." "TypeScript / React / Vite" {
        perspectives {
            "Testing" "Storybook play() + a11y, Playwright Component Tests, Screenplay Tasks shared CT<->E2E, model-based E2E from the rollout machine."
            "Boundary" "Trust (web->gateway consumer side: shared-Zod + golden journey); UI sequence/visual"
        }
    }

    gateway = container "gateway" "The external trust boundary. Proxies every upstream over HTTP (circuit-broken, rate-limited); WS upgrade + ticket redemption; per-community event feed. Enforces no JWT inbound (ADR-0022)." "TypeScript / Fastify :8080" {
        !include components/gateway.dsl
        perspectives {
            "Testing" "Schemathesis fuzzing of the trust boundary; consumer-side Pact (content/identity/...); EvoMaster; RFC 7807 conformance; rate-limit + circuit-breaker property + chaos."
            "Boundary" "Trust (client->gateway); Process (service<->service); Observability"
        }
    }

    content = container "content-service" "Posts and votes within communities. Transactional outbox; recomputed score; community-scoped feed. The Milestone-0 service and the fleet template." "TypeScript / Fastify :8081" {
        !include components/content.dsl
        perspectives {
            "Testing" "fast-check three-tenant interleave (tenancy), single-writer/idempotency property tests, voting invariants, k6 load (feed/vote SLOs), provider-side Pact, Tracetest, message-Pact."
            "Boundary" "Tenancy; Async (events over NATS); Temporal; Observability; Process (provider)"
        }
    }

    identity = container "identity-service" "Communities, users, memberships, sessions; ES256 JWT issuance + JWKS with Clock-driven key rotation; one-use WS tickets." "TypeScript / Fastify :8082" {
        perspectives {
            "Testing" "JWT property tests (issuance/validation/kid/expiry/revocation); JWKS contract (Pact provider); rotation modeled as a state machine."
            "Boundary" "Identity issuance (JWT + JWKS); Process (provider); Tenancy; Temporal"
        }
    }

    flags = container "flags-service" "Per-community feature-flag rollout. A flag value IS the state of a hand-authored XState rollout machine (Off/Enabling/Canary/Enabled/Disabling). Publishes flag.state.changed." "TypeScript / Fastify :8083" {
        perspectives {
            "Testing" "Model-based testing from the rollout XState machine; reverse-conformance on xstate.transition spans; chaos of cache invalidation; provider Pact."
            "Boundary" "State (rollout); Async; Process (provider); Temporal; Observability"
        }
    }

    donations = container "donations-service" "Per-community donations, gated by the donations flag (projected flag_cache), settled via the payment provider. Amounts in integer minor units." "TypeScript / Fastify :8084" {
        perspectives {
            "Testing" "Microcks payment-mock contract; injectable payment-client seam; RFC 7807 dependency_failure on fault; HTTPChaos (Litmus); k6 (observe); EvoMaster."
            "Boundary" "External payment; State; Async (consumes flag events); Process (provider); Temporal"
        }
    }

    moderator = container "moderator-agent" "The one Python service (uv/FastAPI/LangGraph). Retrieval-grounded RAG moderator over a per-community policy corpus (pgvector). Proposes a citation-bearing disposition; never enforces." "Python / FastAPI / LangGraph :8086" {
        !include components/moderator.dsl
        perspectives {
            "Testing" "DeepEval (RAG/agentic/G-Eval) + DeepTeam (OWASP LLM Top 10) + PyRIT (multi-turn) + metamorphic paraphrase-invariance + LangGraph reverse-conformance + abstain path + deterministic guard tests. Cost-guarded, key-gated."
            "Boundary" "External dependency (LLM); Async; Observability"
        }
    }

    webhooks = container "webhooks-service" "The outbound delivery edge (ADR-0019). Pure consumer of all five NATS channels; durable delivery ledger; at-least-once; HMAC-SHA256 signing; SSRF guard; deterministic capped-jittered retry. Publishes nothing." "TypeScript / Fastify :8087" {
        !include components/webhooks.dsl
        perspectives {
            "Testing" "Delivery-guarantee + retry-contract property tests; HMAC + SSRF property tests; delivery XState reverse-conformance + MBT; chaos of a flaky receiver."
            "Boundary" "Delivery edge (outbound webhooks); State; Async; Trust; Tenancy; Temporal"
        }
    }

    mcp = container "qaroom-mcp" "Read-first cross-service MCP tool surface over the services' capabilities (capabilities proxy + RFC 7807 tool errors + read resources + conventions oracle). In-memory + JSON-RPC. NOT cluster-deployed (ADR-0006)." "TypeScript / MCP" {
        perspectives {
            "Testing" "Four typed gates: manifest drift + breaking-change classifier (mcp:verify); RFC 7807 property tests; determinism-trio golden transcript; property + metamorphic tool I/O cross-checked vs /system/capabilities + openapi.yaml."
            "Boundary" "Agent tool surface (read-first); Process (reads capabilities)"
        }
    }

    nats = container "NATS JetStream" "The durable event backbone. Subject grammar qaroom.<service>.<entity>.<community_id>.<event>; community_id fixed at position 3. duplicate_window 5m; at-least-once + outbox + processed_events dedup." "NATS" "Broker"

    contentDb   = container "content DB"   "posts, votes, outbox, processed_events, idempotency_responses." "Postgres 18" "Database"
    identityDb  = container "identity DB"  "users, communities, memberships, sessions, signing_keys (ES256 JWKs), idempotency_responses." "Postgres 18" "Database"
    flagsDb     = container "flags DB"     "flags (rollout state) + outbox + processed_events + idempotency_responses." "Postgres 18" "Database"
    donationsDb = container "donations DB" "donations, flag_cache (projected), outbox, processed_events, idempotency_responses." "Postgres 18" "Database"
    moderatorDb = container "moderator DB" "moderation_decisions + citations, idempotency, policy_corpus + knowledge (pgvector embeddings)." "Postgres 18 + pgvector" "Database"
    webhooksDb  = container "webhooks DB"  "webhook_subscriptions, webhook_deliveries (the at-least-once ledger), processed_events, idempotency_responses." "Postgres 18" "Database"
}

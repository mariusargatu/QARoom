# content-service components — the layered fleet template (every other backend follows this shape).
# Included inside the `content` container block. Deep map: docs/content-service-map.md.

cRoutes   = component "routes"            "Fastify handlers (posts/votes/feed). Parse params + body via Zod, wrap mutations in withIdempotency, emit RFC 7807, validate the response shape before sending." "TS"
cRepo     = component "repository"        "DB access. Advisory lock + SELECT FOR UPDATE; domain write + outbox stage in one tx; explicit traced('db.*') spans; recompute score = sum(votes)." "TS"
cEvents   = component "events"            "Build the Zod-validated PostCreated/VoteCast event and outboxPublish it (subject + name + version + community + payload)." "TS"
cContract = component "contract registry" "The OPERATIONS list feeding openapi.yaml + /system/capabilities + the completeness test; AsyncAPI builder for the two events." "TS"
cFaults   = component "config/faults"     "The single boot-boundary read of the four CONTENT_BUG_* / CHAOS_* toggles into an injected FaultConfig (must stay NODE_ENV-token-free for the matrix census)." "TS"
cDb       = component "db (schema/migrate)" "Drizzle tables + reversible migration fragments + the community_id backfill machine + the shared @qaroom/messaging substrate (outbox, processed_events, idempotency_responses)." "TS / Drizzle"
cRelay    = component "outbox relay"      "@qaroom/messaging: drains committed outbox rows to NATS every ~1s (FOR UPDATE SKIP LOCKED, at-least-once); re-enters the originating trace + tenant scope." "TS"

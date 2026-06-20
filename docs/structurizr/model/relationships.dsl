# Every structural relationship (context + container + component), in one place so the wiring graph
# is reviewable as a unit. Included LAST in the model, after every element exists.
# Convention: HTTP/REST edges tagged "Sync"; NATS JetStream edges tagged "Async" (styled dashed).

# ---- context: people + external systems ----
member        -> qaroom.web     "Posts, votes, donates" "HTTPS" "Sync"
moderatorUser -> qaroom.web     "Reads moderation decisions" "HTTPS" "Sync"
subscriberDev -> qaroom.gateway "Registers webhook subscriptions" "HTTPS" "Sync"
qaroom.webhooks  -> receiver "Delivers signed events (HMAC-SHA256, at-least-once)" "HTTPS" "Sync"
qaroom.donations -> payments "Charges a donation (Microcks-virtualized)" "HTTP/JSON" "Sync"
qaroom.moderator -> openai   "Reranks, drafts, self-checks; embeds corpus + queries" "HTTPS" "Sync"
qaroom -> observ "Exports spans/metrics (every span carries tenant.id)" "OTLP"

# ---- web + gateway (the edge) ----
qaroom.web -> qaroom.gateway "REST + WS feed (one origin, *.localhost via Traefik)" "HTTPS / WSS" "Sync"
qaroom.gateway -> qaroom.web "WS push to the live feed (polling parity)" "WSS" "Async"

# ---- gateway proxies every upstream (HTTP, circuit-broken, rate-limited) ----
qaroom.gateway -> qaroom.content   "Proxies posts/votes/feed" "HTTP/JSON" "Sync"
qaroom.gateway -> qaroom.identity  "Proxies users/communities/sessions; JWKS; redeems WS tickets" "HTTP/JSON" "Sync"
qaroom.gateway -> qaroom.flags     "Proxies flag resolve/rollout" "HTTP/JSON" "Sync"
qaroom.gateway -> qaroom.donations "Proxies donations" "HTTP/JSON" "Sync"
qaroom.gateway -> qaroom.webhooks  "Proxies subscription CRUD" "HTTP/JSON" "Sync"
qaroom.gateway -> qaroom.moderator "Proxies moderation-decision reads (ADR-0022)" "HTTP/JSON" "Sync"

# ---- async event flow (NATS JetStream) ----
qaroom.content   -> qaroom.nats "Publishes post.created, vote.cast" "NATS" "Async"
qaroom.flags     -> qaroom.nats "Publishes flag.state.changed" "NATS" "Async"
qaroom.donations -> qaroom.nats "Publishes donation.state.changed" "NATS" "Async"
qaroom.moderator -> qaroom.nats "Publishes moderation.decision.recorded" "NATS" "Async"

qaroom.nats -> qaroom.donations "flag.state.changed -> flag_cache projection (durable)" "NATS" "Async"
qaroom.nats -> qaroom.moderator "post.created (cross-tenant wildcard) -> review (durable)" "NATS" "Async"
qaroom.nats -> qaroom.gateway   "flag/donation changes -> WS feed (durable)" "NATS" "Async"
qaroom.nats -> qaroom.webhooks  "All five domain events -> fan-out (durable)" "NATS" "Async"

# ---- mcp reads service capabilities (not cluster-deployed) ----
qaroom.mcp -> qaroom.gateway "Reads /system/capabilities + read-only tools" "HTTP/JSON" "Sync"
qaroom.mcp -> qaroom.content "Reads operation registry + read-only tools" "HTTP/JSON" "Sync"

# ---- each service owns its database ----
qaroom.content   -> qaroom.contentDb   "Reads/writes (advisory lock + FOR UPDATE)" "SQL" "Sync"
qaroom.identity  -> qaroom.identityDb  "Reads/writes" "SQL" "Sync"
qaroom.flags     -> qaroom.flagsDb     "Reads/writes" "SQL" "Sync"
qaroom.donations -> qaroom.donationsDb "Reads/writes" "SQL" "Sync"
qaroom.moderator -> qaroom.moderatorDb "Reads/writes + vector recall" "SQL" "Sync"
qaroom.webhooks  -> qaroom.webhooksDb  "Reads/writes (delivery ledger)" "SQL" "Sync"

# ---- content components ----
qaroom.gateway         -> qaroom.content.cRoutes "Proxied HTTP (Idempotency-Key)" "JSON" "Sync"
qaroom.content.cRoutes -> qaroom.content.cRepo     "Calls" "in-proc"
qaroom.content.cRoutes -> qaroom.content.cContract "Validates against" "Zod"
qaroom.content.cRepo   -> qaroom.content.cDb       "Reads/writes via" "Drizzle"
qaroom.content.cRepo   -> qaroom.content.cEvents   "Stages event in the same tx" "in-proc"
qaroom.content.cRepo   -> qaroom.content.cFaults   "Reads injected switches" "in-proc"
qaroom.content.cEvents -> qaroom.content.cDb       "Writes outbox row" "Drizzle"
qaroom.content.cRelay  -> qaroom.content.cDb       "Drains outbox" "Drizzle"
qaroom.content.cRelay  -> qaroom.nats              "Publishes drained events" "NATS" "Async"

# ---- gateway components ----
qaroom.gateway.gRoutes      -> qaroom.gateway.gRateLimit "Throttled by" "in-proc"
qaroom.gateway.gRoutes      -> qaroom.gateway.gOps       "Serves /system/capabilities + /system/limits" "in-proc"
qaroom.gateway.gRoutes      -> qaroom.gateway.gClients   "Dispatches to" "in-proc"
qaroom.gateway.gClients     -> qaroom.gateway.gUpstream  "Calls over" "in-proc"
qaroom.gateway.gUpstream    -> qaroom.gateway.gBreaker   "Guarded by" "in-proc"
qaroom.gateway.gClients     -> qaroom.content            "Proxies" "HTTP/JSON" "Sync"
qaroom.gateway.gWsUpgrade   -> qaroom.identity           "Redeems WS ticket before upgrade" "HTTP/JSON" "Sync"
qaroom.gateway.gJwks        -> qaroom.identity           "Fetches JWKS (Pact-verified)" "HTTP/JSON" "Sync"
qaroom.gateway.gEventStream -> qaroom.nats               "Consumes domain events for the WS feed" "NATS" "Async"

# ---- moderator-agent components (the RAG trajectory) ----
qaroom.nats                 -> qaroom.moderator.mConsumer  "post.created (durable, wildcard)" "NATS" "Async"
qaroom.moderator.mConsumer  -> qaroom.moderator.mGuard     "Fences the post body as DATA" "in-proc"
qaroom.moderator.mGuard     -> qaroom.moderator.mRetrieve  "Starts the trajectory" "in-proc"
qaroom.moderator.mRetrieve  -> qaroom.moderator.mCorpus    "Top-k policy retrieval" "pgvector"
qaroom.moderator.mRetrieve  -> qaroom.moderator.mRerank    "Candidates to rerank" "in-proc"
qaroom.moderator.mRerank    -> qaroom.moderator.mTokenize  "Token-bounds inputs" "in-proc"
qaroom.moderator.mRerank    -> qaroom.moderator.mPrecedent "Narrowed context" "in-proc"
qaroom.moderator.mPrecedent -> qaroom.moderator.mKnowledge "Similar past decisions" "pgvector"
qaroom.moderator.mPrecedent -> qaroom.moderator.mDraft     "Grounded context + precedent" "in-proc"
qaroom.moderator.mDraft     -> qaroom.moderator.mLlm       "Single LLM call" "in-proc"
qaroom.moderator.mLlm       -> openai                      "Chat completion (GenAI-semconv span)" "HTTPS" "Sync"
qaroom.moderator.mDraft     -> qaroom.moderator.mSelfCheck "Disposition + citations" "in-proc"
qaroom.moderator.mSelfCheck -> qaroom.moderator.mRecord    "Validated disposition (or escalate/abstain)" "in-proc"
qaroom.moderator.mRecord    -> qaroom.moderator.mDecisions "Persists decision + citations" "SQL"
qaroom.moderator.mRecord    -> qaroom.moderator.mPublisher "Hands off the recorded event" "in-proc"
qaroom.moderator.mPublisher -> qaroom.nats                 "moderation.decision.recorded" "NATS" "Async"

# ---- webhooks components (the delivery edge) ----
qaroom.nats               -> qaroom.webhooks.wConsumer "All five channels (durable fan-out)" "NATS" "Async"
qaroom.webhooks.wConsumer -> qaroom.webhooks.wRepo     "One delivery row per active subscription" "in-proc"
qaroom.webhooks.wRepo     -> qaroom.webhooksDb         "Subscriptions + delivery ledger" "SQL" "Sync"
qaroom.webhooks.wWorker   -> qaroom.webhooksDb         "Claims due rows (FOR UPDATE SKIP LOCKED)" "SQL" "Sync"
qaroom.webhooks.wWorker   -> qaroom.webhooks.wMachine  "Drives the delivery state machine" "in-proc"
qaroom.webhooks.wWorker   -> qaroom.webhooks.wRetry    "Schedules the next attempt" "in-proc"
qaroom.webhooks.wWorker   -> qaroom.webhooks.wSender   "Sends the signed payload" "in-proc"
qaroom.webhooks.wSender   -> qaroom.webhooks.wSsrf     "Validates the target URL" "in-proc"
qaroom.webhooks.wSender   -> receiver                  "POST signed delivery (HMAC, timestamp-bound)" "HTTPS" "Sync"

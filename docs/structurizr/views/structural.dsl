# Structural (C4) views: context, containers, the four component breakdowns, four dynamic flows,
# and the k3d deployment. Included into `views { }`. Keys match the exported structurizr-<key>.mmd view keys.

systemContext qaroom "Context" "Who uses QARoom and the external systems it depends on." {
    include *
    autolayout lr
}

container qaroom "Containers" "Services, datastores, and the event backbone. Dashed edges are async (NATS); solid are sync (HTTP/SQL)." {
    include *
    autolayout lr
}

component qaroom.content "ContentComponents" "Inside content-service: the layered template the fleet follows (routes -> repository -> events/db/faults + the outbox relay)." {
    include *
    autolayout lr
}

component qaroom.gateway "GatewayComponents" "Inside the gateway: proxy routes + per-upstream clients over a bounded, circuit-broken caller; WS upgrade + ticket; the event-feed stream." {
    include *
    autolayout lr
}

component qaroom.moderator "ModeratorComponents" "Inside moderator-agent: the RAG trajectory consumer -> guard -> retrieve -> rerank -> gather_precedent -> draft -> self_check -> record -> publish." {
    include *
    autolayout lr
}

component qaroom.webhooks "WebhookComponents" "Inside webhooks: fan-out consumer -> delivery ledger; the worker drives the delivery XState machine through the signed sender (SSRF + retry)." {
    include *
    autolayout lr
}

dynamic qaroom "CreatePostFlow" "Create a post: synchronous write + transactional outbox, then async fan-out to moderator + webhooks." {
    member -> qaroom.web "Submits a post"
    qaroom.web -> qaroom.gateway "POST /api/communities/{id}/posts"
    qaroom.gateway -> qaroom.content "Proxies (Idempotency-Key)"
    qaroom.content -> qaroom.contentDb "Insert post + stage outbox (one tx)"
    qaroom.content -> qaroom.nats "Relay drains post.created (~1s)"
    qaroom.nats -> qaroom.moderator "Reviews the post"
    qaroom.nats -> qaroom.webhooks "Fans out to subscribers"
    qaroom.webhooks -> receiver "Signed delivery"
    autolayout lr
}

dynamic qaroom.moderator "ModerationTrajectory" "The RAG trajectory for one post.created: retrieve -> rerank -> precedent -> draft -> self-check -> record (ADR-0020/0021)." {
    qaroom.nats -> qaroom.moderator.mConsumer "post.created (durable, wildcard)"
    qaroom.moderator.mConsumer -> qaroom.moderator.mGuard "Fence body as DATA"
    qaroom.moderator.mGuard -> qaroom.moderator.mRetrieve "Stage-1 retrieve"
    qaroom.moderator.mRetrieve -> qaroom.moderator.mCorpus "Top-k policy"
    qaroom.moderator.mRetrieve -> qaroom.moderator.mRerank "Stage-2 rerank"
    qaroom.moderator.mRerank -> qaroom.moderator.mPrecedent "Gather precedent"
    qaroom.moderator.mPrecedent -> qaroom.moderator.mDraft "Grounded context"
    qaroom.moderator.mDraft -> qaroom.moderator.mLlm "Single LLM call"
    qaroom.moderator.mLlm -> openai "Chat completion"
    qaroom.moderator.mDraft -> qaroom.moderator.mSelfCheck "Disposition + citations"
    qaroom.moderator.mSelfCheck -> qaroom.moderator.mRecord "Validated (or escalate/abstain)"
    qaroom.moderator.mRecord -> qaroom.moderator.mPublisher "Hand off the recorded event"
    qaroom.moderator.mPublisher -> qaroom.nats "moderation.decision.recorded"
    autolayout lr
}

dynamic qaroom.webhooks "WebhookDelivery" "One event fans out to a delivery; the worker drives the XState machine through the signed sender with deterministic retry." {
    qaroom.nats -> qaroom.webhooks.wConsumer "Domain event (durable fan-out)"
    qaroom.webhooks.wConsumer -> qaroom.webhooks.wRepo "Insert one delivery per subscription"
    qaroom.webhooks.wRepo -> qaroom.webhooksDb "Persist to the ledger"
    qaroom.webhooks.wWorker -> qaroom.webhooksDb "Claim due rows (SKIP LOCKED)"
    qaroom.webhooks.wWorker -> qaroom.webhooks.wMachine "Drive delivery state"
    qaroom.webhooks.wWorker -> qaroom.webhooks.wSender "Send signed payload"
    qaroom.webhooks.wSender -> qaroom.webhooks.wSsrf "Validate target URL"
    qaroom.webhooks.wSender -> receiver "POST (HMAC, timestamp-bound)"
    qaroom.webhooks.wWorker -> qaroom.webhooks.wRetry "Schedule next attempt on failure"
    autolayout lr
}

dynamic qaroom "FlagRollout" "A donations-rollout transition propagates: flags publishes, the projection + the live feed react." {
    moderatorUser -> qaroom.web "Advances the rollout"
    qaroom.web -> qaroom.gateway "POST /api/communities/{id}/flags/{key}/rollout"
    qaroom.gateway -> qaroom.flags "Proxies the transition"
    qaroom.flags -> qaroom.nats "Publishes flag.state.changed"
    qaroom.nats -> qaroom.donations "Projects into flag_cache (gating)"
    qaroom.nats -> qaroom.gateway "Pushes to the WS feed"
    qaroom.gateway -> qaroom.web "WsEnvelope (polling parity)"
    autolayout lr
}

deployment qaroom "k3d (local)" "Deployment" "The local cluster: app vs observability namespaces; one shared Helm chart per release; Postgres per service; qaroom-mcp is not deployed." {
    include *
    autolayout lr
}

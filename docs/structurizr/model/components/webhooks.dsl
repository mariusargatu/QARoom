# webhooks-service components — the outbound delivery edge (ADR-0019).
# Pure NATS consumer of all five channels; the delivery ledger IS the at-least-once work queue
# (no outbox; webhooks publishes nothing). Source: services/webhooks/src/*, AGENTS.md.

wConsumer = component "fan-out consumer"   "Durable consumer (webhooks-fanout) of all five entity subjects (post.created, vote.cast, flag.state.changed, donation.state.changed, moderation.decision.recorded). Inserts one delivery row per active subscription; dedup via processed_events + unique (subscription, event)." "TS"
wRepo     = component "repository"         "Transactional mutation of subscriptions + deliveries; advisory lock; validates against the delivery state machine." "TS"
wWorker   = component "delivery worker"    "Relay loop: claims due rows (FOR UPDATE SKIP LOCKED), drives the webhook-delivery XState machine, emits xstate.transition spans (reverse-conformance). Never sleeps; uses injected Clock." "TS"
wMachine  = component "delivery machine"   "Hand-authored webhook-delivery XState machine (Pending/Delivering/Delivered/Retrying/DeadLettered; DeliveryFailed is an event, not a state). The single authority on legal transitions; MBT-walked." "TS / XState"
wSender   = component "sender"             "Injected WebhookSender seam: fetch + AbortController timeout (prod); programmable double (tests). Signs with HMAC-SHA256, timestamp bound into the signature (replay defense)." "TS"
wSsrf     = component "SSRF guard"         "Subscription URL validation: public HTTPS only; rejects loopback / private / link-local. Toggle surface for deliberate-bug demos." "TS"
wRetry    = component "retry schedule"     "Pure-function deterministic capped + jittered backoff from injected Randomness. 'The hardest-to-test part made the easiest' (ADR-0019)." "TS"

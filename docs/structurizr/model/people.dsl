# People (personas) and external software systems.
# Included into the top-level `model { }`. Identifiers here are flat (module scope).
# Source of truth: docs/02-architecture.md (service inventory + boundaries) and ARCHITECTURE.md §1.

member        = person "Community Member" "Posts, votes, and donates within a community (a tenant)."
moderatorUser = person "Human Moderator" "Reviews escalated content; reads citation-bearing moderation decisions. The moderator-agent proposes; a human enforces."
subscriberDev = person "Integrator" "Owns an external system that subscribes to QARoom webhooks; registers subscriptions through the gateway."

openai   = softwareSystem "OpenAI" "LLM (gpt-5-mini) + embeddings for the moderator-agent: rerank, draft, self-check, corpus/retrieval embeddings." "External"
payments = softwareSystem "Payment Provider" "Charges a donation. Virtualized in-cluster by a Microcks mock (payment-provider.openapi.yaml); a stub double in tests." "External"
receiver = softwareSystem "External Webhook Receiver" "Third-party HTTPS endpoint that consumes signed QARoom events (HMAC-SHA256, at-least-once). A dev echo sink runs in-cluster." "External"
observ   = softwareSystem "Observability + Eval Backplane" "OTel Collector to Jaeger + Prometheus/Grafana; Tracetest (trace-as-assertion); Langfuse (LLM traces). Modeled per-component in the deployment view." "External"

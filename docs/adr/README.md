# Architecture decision records

Decisions of record. ADR-0001 is immutable; later ADRs supersede by reference, never by edit.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-foundational-decisions.md) | Foundational architectural decisions | Accepted |
| [0002](0002-asyncapi-drift-gate.md) | AsyncAPI drift gate: detect with `@asyncapi/diff`, classify in-house | Accepted |
| [0003](0003-websocket-mock-strategy.md) | Milestone 5 WebSocket mock: start with `mock-socket`, treat Microcks-async as optional | Accepted (provisional) |
| [0004](0004-code-intelligence-stack.md) | Code-intelligence stack and scale triggers | Accepted |
| [0005](0005-frontend-testing-stack.md) | Frontend testing stack: Storybook + Playwright CT + Screenplay + XState MBT | Accepted |
| [0006](0006-mcp-as-tested-service.md) | MCP server as a first-class tested service | Accepted |
| [0007](0007-communities-as-tenants-shared-schema-discriminator.md) | Communities-as-tenants and the shared-schema discriminator | Accepted |
| [0008](0008-jwt-signing-key-model-and-rotation-contract.md) | JWT signing-key model and rotation contract | Accepted |
| [0009](0009-kubernetes-and-keeping-dev-fast.md) | Kubernetes, and how we keep dev fast | Accepted |
| [0010](0010-sync-vs-async-and-otel-propagation-contract.md) | Sync/async placement, the OTel propagation contract through NATS, and the Milestone 4 consumer scope | Accepted |
| [0011](0011-async-dedup-outbox-msgid-processed-events.md) | Operationalizing Commitment 17: outbox, `Nats-Msg-Id`, `processed_events`, and the accepted async-fuzz gap | Accepted |
| [0012](0012-feature-rollout-state-machine-and-reverse-conformance.md) | Feature-flag rollout as an XState machine, MBT, and reverse conformance | Accepted |
| [0013](0013-websocket-short-lived-ticket-auth.md) | WebSocket authentication via short-lived one-use tickets | Accepted |
| [0014](0014-chaos-as-property-check.md) | Chaos as a property check, not a stunt; why Chaos Mesh and Litmus together | Accepted |
| [0015](0015-scenarios-as-first-class-artifacts.md) | Scenarios as first-class testing artifacts; the limits of replay without a hypervisor | Accepted |
| [0016](0016-testing-your-tests.md) | Testing your tests: when to invest in mutation testing and search-based fuzzing | Accepted |
| [0017](0017-testing-ai-integrated-systems.md) | Testing AI-integrated systems: the techniques that don't fit the traditional pyramid | Accepted |
| [0018](0018-moderator-agent-architecture.md) | The moderator-agent: a Python LLM service on the QARoom substrate | Accepted |
| [0019](0019-webhooks-as-a-tested-delivery-edge.md) | Webhooks: an outbound delivery edge over the NATS event seam | Accepted |
| [0020](0020-moderator-rag-and-eval-stack.md) | Moderator as a retrieval-grounded agent; the eval + red-team stack | Accepted |
| [0021](0021-separable-retrieval-components.md) | Separable retrieval components: tokenizer seam + two-stage retrieval (reranker) | Accepted |
| [0022](0022-gateway-fronts-identity-and-moderation-for-the-web-edge.md) | Gateway fronts identity + moderation reads for the web edge | Accepted |
| [0023](0023-remove-llms-txt-affordance.md) | Remove the llms.txt affordance; AGENTS.md and the MCP surface are the agent front door | Accepted |

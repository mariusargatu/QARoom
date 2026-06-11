# QARoom: Vision

*Written before Milestone 0 and preserved as the original thesis. The plan said ten milestones; the build grew to thirteen (0-12), webhooks became a shipped service, and some tools changed along the way. The living state is the [README](../README.md) and [docs/04-roadmap.md](04-roadmap.md).*

*The Testable Stack, Volume I: building a modern microservices system from a testing lens.*

---

## The frame

Most engineers learn testing as something you do *to* code. You write a function. You write a test for it. You write more tests as bugs surface. Testing is a hygiene activity, sometimes a craft, occasionally a discipline, but almost always reactive. The system exists; you test it.

This series inverts that. I am going to design and build a system where testing is the lens through which every architectural decision is made. Not "we will write tests for what we build", but "we will build what we can rigorously test, with the techniques chosen to fit the boundaries those techniques naturally protect." Architecture and testing become a single design activity, not two separate ones.

The system is QARoom: a Reddit-shaped social platform with multi-tenant communities and a gradually-rolled-out donations feature. The product is deliberately modest: I have no ambition to ship a social network. The architecture is deliberately rich: it is sized exactly to demonstrate, in their natural habitats, a portfolio of testing techniques most engineers either don't know exist or have only ever seen in isolated tutorials.

Across ten milestones I will build this system, with each milestone introducing a small, sharply-defined testing technique applied to the architectural boundary that needs it. Every milestone ships a working artifact and an architecture decision record. Milestones are sized to be demonstrable, not to a fixed schedule. They ship when they ship. The goal is not to finish on a timeline; the goal is to demonstrate.

## Who this is for

Senior engineers and architects who already know how to write tests, but want a sharper way to think about *what* to test, *where* the boundaries belong, and *why* the architecture itself determines which testing techniques work and which collapse. This is a long-form argument about how to think, not a tutorial on Vitest or Playwright.

This series is for you if you have shipped microservices and felt that your testing was a portfolio of disconnected practices loosely organized around the test pyramid; if you have read about contract testing, property-based testing, chaos engineering, model-based testing, and mutation testing in separate posts and wondered how they actually compose into a coherent strategy; or if you want to see a single developer using Claude Code to build a substantial microservices system across ten milestones, with explicit architectural reasoning recorded alongside the code.

## What is locked, what is discovered

I am writing this introduction with full knowledge that some of my commitments will prove wrong. The discipline I am imposing on the series is to distinguish what is locked from what will emerge from doing.

**Locked** are the architectural commitments: microservices on Kubernetes, TypeScript for the core, schema-first contracts with bidirectional verification, async messaging via NATS JetStream, model-based testing as the central technique, determinism abstractions in every service, observable state endpoints, tenant isolation as a property, and a designed-for-LLM-agents substrate. These are not negotiable mid-series. They are the lens.

**Discovered** are the implementation choices: which exact library, which version, which YAML layout, which scenario file format. These will be made milestone by milestone, in ADRs, with the freedom to change as I learn. Writing them down upfront would be aspirational fiction.

This distinction matters because the most common failure mode for ambitious architecture series is to lock too much too early, then either ship a fiction or quietly contradict the locked commitments later. I am refusing that failure mode by being explicit about what level each decision lives at.

## The product, briefly

QARoom is a Reddit-shaped platform. Users post and comment. They vote up or down. Posts and comments live inside communities. Each community is an isolated tenant: its posts, votes, and karma do not leak across the boundary. A donations feature lets users tip posts, comments, or communities, but donations are gated by a per-community feature flag that is rolled out gradually. The rollout is a state machine: disabled, enabling, enabled, disabling. Every architectural choice traces back to one of these properties.

Future milestones add: a real-time notification layer over WebSockets, a chaos-tested resilience story, a scoped scenario replay system, and an agentic community moderator built on LangGraph as the ultimate demonstration of how the architecture welcomes LLM-powered features without rework.

## The architectural lens

Six principles drive the design. Each is the locked answer to a question that most projects answer implicitly and badly.

**1. Testability is an architectural property, not a quality of test code.**
The reason most teams' testing is mediocre is not that they write bad tests; it is that their architecture makes good testing impossible. Boundaries that don't exist cannot be contract-tested. State that isn't observable cannot be model-checked. And you cannot replay behavior that was never deterministic. We will design with these constraints in mind, and the testing techniques will fall out naturally.

**2. Boundaries are where bugs hide; every boundary in QARoom has a named testing technique that defends it.**
Service boundaries get contract tests (Pact). Tenant boundaries get property-based isolation tests (fast-check). Temporal boundaries (state transitions, gradual rollouts) get model-based tests (XState). External dependency boundaries get schema validation and chaos tests. The system is a structured graph of boundaries, each with its own defender, not a uniform field with tests sprinkled on top.

**3. The model is the source of truth, not documentation.**
Every stateful flow in QARoom is modeled as a graph: XState for TypeScript flows, LangGraph for Python flows that come later. The model is hand-authored, lives in its own package, and is the contract that the production code and the tests both consult. If they disagree, the code is wrong, not the model. Drift between model and reality is impossible by construction. Or, more honestly, by enforcement.

**4. Determinism is non-negotiable.**
Every service injects a `Clock`, `IdGenerator`, and `Randomness` interface. Production uses real implementations; tests use seeded, deterministic ones. More than a convenience, this is the precondition for several of the techniques the series demonstrates, from property-based testing to scoped scenario replay. Leakage of non-determinism is treated as a P0 defect.

**5. Triangulation defends against silent drift.**
Schema-first contracts via Zod with generated OpenAPI committed alongside, drift-gated by oasdiff in CI, with consumer-authored Pact files as the second independent source of truth, and conformance tests that verify the running system matches its specs. No artifact is generated by an opaque process from another artifact such that a developer can update both with one edit. Disagreement between artifacts is loud, not silent. *Bidirectional verification* in practice is unidirectional generation plus diff-gated change review, but it is rigorous, and it works.

**6. The architecture is designed for LLM agents to be future first-class users.**
Not because I am building agentic features in v1, but because the cost of designing for them now is small and the cost of retrofitting later is enormous. Every error follows RFC 7807 Problem Details with agent-actionable extensions. Every service exposes `/system/state` and `/system/capabilities` in MCP-compatible shapes. OpenTelemetry GenAI semantic conventions are opted in across the stack. AGENTS.md and CLAUDE.md exist from day one. Tests emit structured JSON. The substrate is agent-hospitable; the agents come later.

## The testing portfolio

Across the ten milestones, QARoom demonstrates the following techniques, each in the architectural boundary it naturally protects:

- **Unit testing** with Vitest, for pure functions inside services.
- **Property-based testing** with fast-check, for invariants and tenant-isolation guarantees.
- **Schema validation** with Zod and OpenAPI, gated by oasdiff for drift detection.
- **Consumer-driven contract testing** with Pact v4, for both REST and async NATS messages.
- **Property-based API exploration** with Schemathesis, for fuzzing services against their OpenAPI specs.
- **Search-based fuzzing** with EvoMaster, for evolutionary discovery of uncovered code paths.
- **Service virtualization** with Microcks, for mocking external dependencies from their schemas.
- **Model-based end-to-end testing** with XState and Playwright, for state-machine-driven test generation.
- **Distributed tracing as a testable surface** with OpenTelemetry, Jaeger, and Tracetest.
- **Chaos engineering** with Chaos Mesh (with Litmus for HTTP-level chaos), for hypothesis-driven resilience testing.
- **Load testing** with k6, against SLOs documented per endpoint.
- **Mutation testing** with Stryker, for verifying that the tests themselves are sensitive.
- **Database migration testing** as a state-machine-modeled discipline.
- **Scoped scenario replay** for reproducing distributed system bugs locally with documented limits.
- **LLM evaluation** with Promptfoo (in the final milestone, for the agentic moderator).

Two of these techniques, Pact and Schemathesis, overlap in surface (both generate API calls) but differ in philosophy (consumer-driven, schema-driven). The series will be explicit about what each catches that the other cannot. Three more (fast-check, Schemathesis, and EvoMaster) overlap in being property/exploration-based, but again differ: invariant-driven, schema-driven, search-driven. These distinctions are themselves the lesson.

## What I am explicitly not doing

Multi-region deployments. Real OAuth or federation. Real payments. Internationalization. Production-grade security testing. Visual regression. Accessibility testing. Webhooks (deferred to a future series). Each of these is a real, legitimate concern; none of them are needed to demonstrate the architectural lens I am writing about, and including them would dilute the message. The deliberate exclusions are part of the contract with the reader.

## What I expect to get wrong

A confession: I do not know whether all ten milestones will land equally well. Some techniques (model-based testing, chaos engineering, scoped scenario replay) have headline potential. Others (mutation testing, search-based fuzzing) are quieter. Some of my locked commitments will prove harder than I expect; some will prove easier. The series is the journey of finding out, narrated honestly as it happens.

What I am committed to is the lens itself: that testability is an architectural property, that boundaries are where bugs hide, that the model is the source of truth, that determinism is non-negotiable, that triangulation defends against silent drift, and that the substrate should welcome the LLM agents that are coming whether or not I want them.

Each milestone ships its own post. They can be read independently. But they accumulate, and by the end you will have seen a single coherent argument: that designing from a testing lens is not just defensible but materially better than the alternative, and that the resulting architecture is one I would happily ship in production.

Volume I begins now.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/detection-matrix-dark.svg">
  <img alt="QARoom detection matrix: every seeded bug down the side, every testing technique across the top, each cell marked catch or honest miss." src="docs/assets/detection-matrix-light.svg" width="100%">
</picture>

# QARoom: proof that the tests actually work

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/mariusargatu/QARoom/ci.yml?branch=main&label=CI)](https://github.com/mariusargatu/QARoom/actions)
[![Live demo](https://img.shields.io/badge/demo-live-EAB24E)](https://mariusargatu.github.io/QARoom/)

QARoom is a small but realistic app. It has communities, posts, votes, donations, outbound webhooks, and an **AI content moderator**. It runs on the kind of stack many teams use today: TypeScript services, a React frontend, a Python AI service, async messaging, and Kubernetes.

It exists to answer one question, with proof you can run yourself: **when the tests are green, can you trust them?**

---

## Is this a problem you have right now?

If any of these sound familiar, this repo is a worked answer. Not a blog post, a running system you can poke at.

| Your worry | What this repo shows |
|---|---|
| *"We ship fast. I am not sure our tests would actually catch a real bug."* | Every guarantee ships with **the real bug that breaks it** and one command to watch a real test go red. A green suite proves nothing by itself. This shows the catch. |
| *"How do you even test an AI feature that gives a different answer every time?"* | The AI moderator is tested by the **rules it must never break** (never confidently approve flagged content, ask a human when unsure, ignore hidden instructions), not by pinning one exact answer. [See how](#the-hard-part-testing-the-ai) |
| *"Our test suite is slow and needs a whole cluster to run."* | The **full suite runs in seconds, no Docker**. The database runs inside the test process. |
| *"I cannot tell what our tests do not cover."* | An **honest grid** (the picture at the top) shows which bugs each technique catches, and which slip through. It leads with the gaps, not the wins. |

---

## The 30 second proof

Most demos show you a passing test suite. This one hands you the bug and lets you watch a real test fail, then pass:

```bash
pnpm prove webhook-signing --break   # turn on a real bug, a real test goes RED
pnpm prove webhook-signing           # turn it off, GREEN again
```

That is the whole idea in two lines: **a test you cannot make fail is not protecting you.** Every promise in this repo comes with the bug that breaks it and the command that proves the test catches it. [The full list, in plain English](docs/claims.md)

---

## The hard part: testing the AI

An AI feature is the scariest thing to ship, because it is non deterministic. Same input, different output. You cannot write `expect(answer).toBe("...")`. So instead of checking the exact words, QARoom checks the **safety rules that must always hold**, no matter what the model says:

- **It never confidently approves content the rules flag.** If the AI says "approve" but precedent says remove, it is forced to escalate to a human instead. A confidently wrong "this is fine" cannot ship.
- **It asks for help when unsure** instead of guessing.
- **It ignores hidden instructions** smuggled inside a user's post or a retrieved document. This attack is called prompt injection.

Each of those is a switch you can flip to see the protection work: `pnpm prove moderator-no-confident-approve-of-flag --break`. On top of that it runs paraphrase tests (does the answer stay stable if you reword the input?), a graded answer set, and standard AI security red teaming.

---

## What it demonstrates

In plain terms, the skills behind the repo:

- **Quality designed into the system, not bolted on.** Things like a controllable clock and inspectable state are built in, so whole kinds of tests become possible and reliable that otherwise are not.
- **Honesty over green checkmarks.** The repo measures whether its own tests have teeth (a technique called mutation testing) and publishes what it does not catch. No coverage theater.
- **Judgment about cost.** Fast cheap tests run on every change. Expensive ones (full cluster, load, AI evaluations) run only when they are worth it. Every technique has to earn its place.
- **The full kit of basics, present and green:** unit, integration, and end to end tests, contract tests between services, API fuzzing, Playwright browser tests, strict TypeScript, CI on every change.

---

## See it, run it

**Fastest, no install, two minutes:** the [**live walkthrough**](https://mariusargatu.github.io/QARoom/) explains every kind of testing here in plain English, one real example each. **Start there.**

**Run the tests yourself, no Docker needed:**

```bash
pnpm install
pnpm test            # the whole suite, runs in seconds
pnpm prove           # the list of guarantees you can break on demand
```

**Run the whole system locally (optional, needs Docker):**

```bash
pnpm dev             # every service plus dashboards on a local cluster
pnpm dev:down        # tear it down
```
> Heavy: about 15 containers and a monitoring stack. Give Docker 8 GB RAM and 4 CPUs. You do not need it to read the code or run the tests.

---

## The techniques, by where they apply

Scan to your world.

#### Frontend -> the React UI
1. **Storybook** play tests + accessibility
2. **Playwright** component tests and model based E2E
3. **Visual regression** on pinned baselines

#### Backend -> one service at a time
4. **Vitest / pytest** unit tests
5. **PGlite** integration on a real in process Postgres
6. **fast-check** property based tests
7. **Zod** one schema, OpenAPI generated from it
8. **Schemathesis** API fuzzing

#### Distributed -> between services
9. **Pact v4** contract tests, cross checked against OpenAPI
10. **oasdiff + AsyncAPI diff** breaking change gates
11. **Outbox + dedup** typed events, never lost or doubled
12. **Tracetest** trace structure assertions
13. **Reverse conformance** running system vs its state machine
14. **XState** model based testing
15. **OpenTelemetry** observability as a test surface
16. **Microcks** external payment mock
17. **Golden journey** full path across services

#### LLM apps -> the non deterministic part
18. **DeepEval** graded answer evals
19. **Metamorphic** paraphrase invariance
20. **DeepTeam + PyRIT** red teaming, OWASP LLM Top 10
21. **Pydantic vs Zod** structured output across languages
22. **LangGraph** trajectory reverse conformance
23. **Prompt injection guards** on input and retrieved docs
24. **Safety invariant** blocks a confidently wrong approval

#### Context dependent -> reach for when the risk earns the cost
25. **Stryker** mutation testing (does the suite have teeth)
26. **EvoMaster** search based fuzzing
27. **k6** load vs SLOs
28. **Chaos Mesh + Litmus** chaos engineering
29. **Scenario replay** capture and reproduce incidents
30. **TLA+ / DST / CrossHair** formal, simulation, and symbolic checks

---

## Go deeper

- [**The live walkthrough**](https://mariusargatu.github.io/QARoom/): plain English tour. Best first stop.
- [**ARCHITECTURE.md**](ARCHITECTURE.md): the whole system and how it is tested, on one page. Starts with a two minute plain summary.
- [**What it catches, and what it misses**](docs/detection-matrix.md): the honest grid from the top of this page.
- [**The guarantees you can break**](docs/claims.md): every promise, its bug, and the command to test it.
- [**The decisions**](docs/adr/README.md): every significant choice, with the alternatives it rejected.
- [**The operating model**](docs/operating-model.md): what this costs, where it rubs, what it deliberately refuses to do.
- [**The feasibility spikes**](docs/spikes/): how each technique was vetted before it earned its place (Milestone 0, kept for the record).

---

## License

MIT for the code ([LICENSE](LICENSE)). CC-BY for the writing under `docs/`.

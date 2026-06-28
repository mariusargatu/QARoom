# The operating model: where this discipline costs, breaks, and is the wrong choice

This is the honest companion to [ARCHITECTURE.md](../ARCHITECTURE.md) and
[ADR-0030](adr/0030-checking-architecture-in-service-of-a-testing-mission.md). ARCHITECTURE.md is the
*landscape*; this doc is the *operating model* — what it costs to run, the frictions it does not fully
defeat, what survives a one-day time budget, and when a team should **not** adopt it. A strategy that
only documents its strengths is the theater this repo refuses to perform.

## 1. Where the model breaks (named frictions)

Each friction is real and observed. For each: *how QARoom defends it — or admits it doesn't.*

| Friction | What goes wrong | How QARoom defends it — or doesn't |
|---|---|---|
| **The oracle problem** | A maximally severe check of the *wrong* property is confidently wrong, faster. Severity says nothing about whether the asserted property is the right one. | **Not defended — named.** No gate closes it ([ADR-0030](adr/0030-checking-architecture-in-service-of-a-testing-mission.md) open problem 1). It is mitigated only by keeping the human conjecture visible and reviewed, and by oracle *independence* (a law or a second source is harder to assert wrongly than a hand-typed expected value). |
| **The change-amplification cost** | One field added to a request touches the Zod schema, the consumer Pact, the handler, the regenerated+diffed OpenAPI, and maybe the XState model. Five edits for one idea. | **Accepted, by design** (ARCHITECTURE.md §4): the alternative is silent drift, which destroys the value of having tests at all. The single-source derivation keeps the *count* of independent edits minimal — most are regenerated, not hand-authored. |
| **The agent attacks the gates** | An agent that writes the code and runs its checks can edit a test, neuter an oracle, drift a generated artifact, or patch around a gate to force green. | **Defended, partially** ([ADR-0032](adr/0032-agentic-development-as-a-tested-boundary.md)/[0033](adr/0033-check-governance-and-tamper-evidence-under-an-adversarial-writer.md)): mutation-killed assertions, single-source invariant gates the agent cannot game, derivation-chain CODEOWNERS, adversarial `prove --break`. **Residual:** the top of the chain is a *social* gate until branch protection + out-of-band attestation exist (open problem 4). |
| **Corroboration is not confirmation** | A green suite is "survived this round," never "correct." You still have to ship something. | **Honest two-tool split** ([ADR-0030](adr/0030-checking-architecture-in-service-of-a-testing-mission.md) §2): Popper for design discipline, an explicit *inductive* risk-based-stopping warrant for go/no-go. The docs never write corroboration as proof. |
| **`true_head ≠ green_head`** | At agent velocity the last *green* commit is not the last *trustworthy* one; flakes and batched merges blur which change is accountable. | **Seam realized** ([ADR-0026](adr/0026-auto-merge-router-and-why-the-gate-claim-stays-out-of-the-manifest.md)); the risk-tiered promotion ledger + batch-bisect is the named T24 extension. Never reward at presubmit; no auto-revert on the stateful class. |
| **Severity is fault-model-relative** | Chase the severity number and you optimize the breaks you can already imagine — Goodhart. | **Defended by axis choice:** the better axis is *oracle independence* ([severity-oracle-independence.md](severity-oracle-independence.md)), a ladder you can climb deliberately rather than a scalar to maximize. |
| **Environmental / live-tier gates read green when absent** | Cluster-only or key-only checks (tenant-span live audit, EvoMaster, eval lanes) are skipped, not run, when their infra is down — a skip can masquerade as a pass. | **Defended by in-process primaries** ([ADR-0028](adr/0028-in-process-tenant-span-gate-primary-live-audit-corroboration.md)): the crown-jewel invariants get a cheap every-PR gate; the live tier is corroboration. **Residual:** named, not eliminated — the deployed-system property genuinely needs the cluster. |

## 2. The gate economics (technique → cost → what it buys → keep/subset rule)

Every check is a spend. The portfolio is built so *confidence-per-dollar*, not coverage, is the
currency (ARCHITECTURE.md §7). The keep/subset column is the rule that bounds the cost.

| Technique | Cost tier | What it buys (the distinct question) | Keep / subset rule |
|---|---|---|---|
| Vitest unit + fast-check property | A (in-proc) | does a unit, and its invariants over generated inputs, hold? | **Keep all** — cheapest rung, runs every PR. |
| Zod-derived contract + `oasdiff` / `asyncapi:verify` | A | did a contract drift between code and its published spec? | **Keep all** — derivation is near-free; drift is silent otherwise. |
| Pact v4 (REST + message) + Pact↔OpenAPI cross-check | A | does a consumer's real dependency, and the spec, agree? | **Keep all** — the differential rung for the process boundary. |
| PGlite integration | A | does the service hold against a real Postgres, no Docker? | **Keep all** — in-process, seconds. |
| Stryker mutation | A, but slow | is the *suite itself* any good (severity holes)? | **Subset** — locked critical modules + the harness surface only (ADR-0016/0031); full-tree is a dispatched nightly. |
| Storybook + Playwright CT | A | do UI states and sequences render and behave? | **Keep** — the cap of the UI honeycomb. |
| Schemathesis stateful, EvoMaster | B (cluster) | what spec-violating input has nobody written by hand? | **Merge / nightly** — needs a live service; never per-PR. |
| Tracetest reverse-conformance, Microcks | B | does the *deployed* trace structure match the model? | **Merge** — the deployed-system oracle. |
| Chaos Mesh + Litmus, k6 vs SLOs | B | does documented failure behaviour / the SLO hold under fault and load? | **Nightly** — expensive, infra-bound. |
| DeepEval / DeepTeam / PyRIT, metamorphic | C (key-gated, $) | is the LLM grounded, calibrated, and adversarially robust? | **Cron / dispatch only** — the one lane that spends real money; cost-bounded before it runs (ARCHITECTURE.md §5). |

The rule the table encodes: **the cap does not cover I/O, time, or integration** (so it stays thin and
every-PR); **the integration band carries the weight**; **the E2E base runs merge-to-main / nightly,
never per-PR.** Push a technique up a tier only when the question it answers cannot be answered cheaper.

## 3. The time-pressure degradation tier

The portfolio is a maximum, not a minimum. Under a real budget you drop tiers from the bottom up and
**name the risk you are accepting** — a degraded strategy with a stated residual beats a full strategy
you cannot afford to run.

| Budget | What you run | Risk you explicitly accept |
|---|---|---|
| **1 day** | Tier A only: lint + typecheck, Vitest units + fast-check, Zod-derived contracts + `oasdiff`, Pact + cross-check, PGlite integration, the drift gates (`links`/`stats`/`claims`/`census`/`tour`). One `pnpm verify`. | No deployed-system evidence: propagation across NATS, real trace structure, chaos/fault behaviour, load/SLO, and LLM calibration are **unchecked**. You are trusting the in-process proxies. |
| **3 days** | Tier A + the merge tier: Schemathesis stateful, Tracetest reverse-conformance, Microcks, web component. | No nightly evidence: chaos, k6/SLO, full-tree mutation, EvoMaster. Failure-mode and load regressions can land silently. |
| **1 week+** | Everything, including the nightly + key-gated lanes; the full `pnpm gauntlet`. | The standing residuals only: the oracle problem, the social top-of-chain, the un-formulated anchored ratio ([ADR-0030](adr/0030-checking-architecture-in-service-of-a-testing-mission.md) open problems). |

The **non-negotiable floor** at any budget is the single-source invariant gates (the vote `±1` DB
`CHECK`, the tenant-isolation property) and the drift gates: they are Tier-A-cheap and they defend the
properties whose silent failure is least recoverable.

## 4. The restraint rule: when this discipline is the *wrong* choice

This architecture's complexity must earn its place (ARCHITECTURE.md §1), and on many systems it does
not. **Do not adopt this model when:**

- **The stakes are low and the surface is CRUD.** A form-over-a-table app, an internal tool with three
  users, a throwaway prototype: the change-amplification cost (one idea, five edits) buys confidence
  nobody needs, and the right strategy is a thin layer of example tests plus a type checker. Triangulated
  contracts and a honeycomb-by-boundary defend boundaries this system does not have.
- **There are no real boundaries to defend.** The whole strategy is *boundary-shaped*. A monolith with
  no process, async, or tenancy seams has nothing for Pact, AsyncAPI drift, or isolation properties to
  bite on; forcing them in creates ceremony, not severity.
- **The team cannot sustain the derivation discipline.** Single-source-derived-everywhere only holds if
  every change runs the regen + drift gate. A team that will skip that turns the gates into noise — at
  which point fewer, stronger checks beat many advisory ones.

The honest test: *does each technique demonstrate a distinct testing philosophy this system actually
needs?* If not, it is excluded — the same rule the architecture applies to itself (ARCHITECTURE.md §7).

## 5. Open question: the talent pipeline (a picked stance)

A strategy this dependent on **sapient judgment** — choosing invariants, ranking oracles, interpreting
counterexamples, deciding a leak matters — raises a staffing question the automation cannot answer:
*where do the people who can do that come from, and does an agent-heavy workflow erode the very
pipeline that produces them?* If agents write the spec-derived mass and juniors never hand-build the
mechanical checks, the apprenticeship that grows oracle-design judgment may quietly disappear.

**The picked stance:** the division of labor is the answer *and* the risk. Agents should do the
spec-derived mechanical mass; humans spend their scarce judgment on the emergent, unspecified risk
surface — *which is the highest-leverage place to train judgment*, not the lowest. The deliberate
practice is to route humans toward **oracle design and threat modeling** (writing the conjecture, picking
the rung on the independence ladder, reading a surviving mutant) and away from boilerplate assertion
authoring the agent does better anyway. The residual risk — that the on-ramp to *that* skill still runs
through the boilerplate we are automating — is real and **named, not solved**: it is the human-capital
analogue of the oracle problem, and it belongs on the table next to it.

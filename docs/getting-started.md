# Getting started: your first feature

This is the Layer-1 on-ramp — the small, non-derivable narrative that gets you from "I have an idea for a
change" to "the gates are green and the judgment is mine." It is deliberately short. The mechanical detail
lives in the recipe ([add-a-field.md](add-a-field.md)) and the conventions live in their gates (the lint
plugin + the drift gates, not in prose). Read [ARCHITECTURE.md](../ARCHITECTURE.md) for the landscape and
[ADR-0030](adr/0030-checking-architecture-in-service-of-a-testing-mission.md) for *why* the repo is shaped
this way; come back here to actually ship something.

## The one thing to understand first

QARoom is **single-source-derived**. One idea — "donations should carry a short message" — does not mean
one edit. It means *one edit to the source of truth*, then a fan-out of **generated** artifacts the gates
keep honest. You do not hand-write the OpenAPI, the DB column shape, or the property generator's input
space; you edit the **Zod schema** and regenerate. This is the triangulation tax
([operating-model.md](operating-model.md) §1), and the recipe below is its on-ramp: most of the five
edits are `pnpm <generate>` commands, not hand-authoring.

The rule that makes this safe: **the gate is the spec.** If you are tempted to write a prose rule, find
the gate that already enforces it and point at that instead. A "must" without a gate is debt
([ADR-0038](adr/0038-operating-model-onboarding-agent-tax-and-incident-to-claim.md)).

## A worked change: add an optional `message` to a donation

We will add an optional, short `message` field to a donation, end to end. Follow it once and the tax stops
being a surprise.

### 1. Edit the ONE source — the Zod schema

[`packages/contracts/src/donation.ts`](../packages/contracts/src/donation.ts) is the authority. A donation
and its create-request both live there. You add the field in **one** place on each:

```ts
// in CreateDonationRequest (the .strictObject) and Donation:
message: z.string().max(280).optional(),
```

That single edit is the source. Everything below is *derived* from it — you regenerate, you do not retype.

### 2. Regenerate the derived contract artifacts

```bash
pnpm openapi:generate    # Zod -> services/*/openapi.yaml (the donations spec now carries `message`)
pnpm openapi:verify      # gate: the committed spec equals what Zod generates, no undeclared breaking change
```

`message` is **optional**, so `oasdiff` reports a non-breaking addition. (Had you added a *required* field,
the gate would red and tell you — that is the breaking-change contract doing its job, not an obstacle.)
Commit the regenerated `openapi.yaml` alongside the schema edit; the drift gate exists precisely so the
two cannot diverge.

### 3. Let the generator and the property space follow

The shared generators in [`packages/testing-utils/src/generators`](../packages/testing-utils/src/generators)
build domain objects for property tests. Because they build from the contract types, your new optional
field is already a legal (absent-or-present) value — you usually change nothing here. Reach for an existing
generator before writing a new one (root [AGENTS.md](../AGENTS.md) → "How to make changes").

### 4. The consumer contract (Pact), if a caller sends it

If a caller will *send* `message`, that caller owns a Pact consumer test under
[`services/donations/tests/contracts`](../services/donations/tests/contracts). Add an interaction that
includes the field; provider verification in donations confirms the real service honours it. (If nobody
sends it yet, you do not invent a consumer — the recipe stops here.)

### 5. STOP at the judgment review

The mechanical mass is done. What the generators **cannot** decide for you:

- **The oracle.** What is the *right* behaviour? Is an empty `message` distinct from an absent one? Does it
  appear in the feed, the event payload, the webhook? Each is a human conjecture, not a generated fact.
- **The threat model.** `message` is attacker-controlled free text. Does it reach the moderator's prompt
  context (it must be *fenced as data*, see the `input-guard-fences-untrusted-body` claim)? A span (it must
  carry no PII, `pii-free-spans`)? That is where your judgment is the highest-leverage thing in the change.

Write the assertion that pins *your* conjecture, run `pnpm verify`, and you are done.

## The loop, in one line

> Edit the Zod source → `pnpm openapi:generate` → regenerate/scaffold the derived artifacts → **stop at the
> oracle + threat model** (yours) → `pnpm verify`.

The mechanical recipe with the exact commands and the scaffold step is [add-a-field.md](add-a-field.md).
When you are done, if the change came out of an incident, encode the lesson as a falsifiable claim —
[incident-to-claim.md](incident-to-claim.md).

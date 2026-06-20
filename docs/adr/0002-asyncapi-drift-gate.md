# ADR 0002: AsyncAPI drift gate: detect with `@asyncapi/diff`, classify in-house

- **Status:** Accepted
- **Date:** 2026-05-29
- **Records:** the Milestone 0 spike-5 outcome and **exercises a contingency ADR-0001 already
  granted**: Commitment 3 says the async gate uses "`@asyncapi/diff` (or a thin custom
  check if `@asyncapi/diff` proves insufficient, see Milestone 0 spike)." This ADR does not
  modify ADR-0001; it selects that pre-authorized fallback and pins the Milestone 4 tool choice.

## Context

ADR-0001 Commitment 3 says async drift is "gated in CI by `@asyncapi/diff` (or a thin
custom check if `@asyncapi/diff` proves insufficient, see Milestone 0 spike)." Milestone 0
spike 5 ([docs/spikes/05-asyncapi-drift-gate.md](../spikes/05-asyncapi-drift-gate.md)) ran that evaluation.

Finding: `@asyncapi/diff@0.5.0` reliably **detects** structural changes (it emits a
precise JSON-pointer change list) but its default **classification** is unfit for our
gate: it marked only `/info/version` as breaking and parked the genuinely breaking
payload changes (removed required property, type change) as `unclassified`. The
`override` ruleset did not reclassify them within the spike's time box.

## Decision

Milestone 4's async drift gate will:

1. Use `@asyncapi/diff` purely as a **change-detector**: consume its raw change set.
2. Apply a **QARoom classifier** (`packages/testing-utils/async-diff/`) that maps changes
   to `breaking | nonBreaking` with explicit rules, mirroring the `oasdiff` philosophy
   already used for REST. **Classification MUST be relative to the operation's direction**
   (`publish` = the app sends; `subscribe` = the app receives), because the same structural
   change flips breaking-ness between producer and consumer. The baseline rules below are
   stated for a consumer-facing message; the classifier resolves direction per operation:
   - under `.../payload/properties/*`: `remove` ⇒ breaking, `edit` of `type` ⇒ breaking, `add` ⇒ nonBreaking;
   - under `.../payload/required`: for a message the app **receives**, `remove` ⇒ breaking
     (consumers lose a guaranteed field) and `add` ⇒ nonBreaking; for a message the app
     **sends**, `add` ⇒ breaking (producers must now populate it). Do **not** ship the
     direction-blind table: that was the trap the spike flagged.
   - channel removal ⇒ breaking; channel addition ⇒ nonBreaking.
3. Gate CI on any `breaking` classification, consistent with the per-event versioning
   discipline in Commitment 3 (frozen `*.vN.ts` event schemas).

This is the "thin custom check" Commitment 3 already foresaw; it does not weaken any
commitment: it makes the async gate as strict as the REST gate.

## Consequences

- Milestone 4 adds `packages/testing-utils/async-diff/` (classifier over `@asyncapi/diff`).
- The classifier's rule table is itself contract-tested (fixtures: known breaking vs
  non-breaking pairs), the same way `scripts/openapi-verify.ts` proves the oasdiff gate.
- If a future `@asyncapi/diff` release ships sufficient built-in classification, the
  classifier can be retired without changing the gate's contract.

# ADR 0035: Row-Level Security as a second tenancy layer, and a test that catches a broken service layer (T06)

- **Status:** Proposed
- **Date:** 2026-06-28
- **Records:** the decision to add Postgres **Row-Level Security (RLS)** as a *second*, database-level
  tenancy layer beneath the service-layer `WHERE` filter, bound to the request's community through a
  transaction-local session GUC; and a test that proves the new layer **catches a deliberately broken
  service layer** — a cross-tenant read with the service filter removed entirely still returns only the
  bound community's rows because the database refuses the rest. It also records **why RLS was not in the
  original design** (pedagogy + a PGlite enforcement finding) and the **scope** (content is the proven
  exemplar; the fleet extension is a documented per-service follow-up).
- **Does not modify** [ADR-0001](0001-foundational-decisions.md). Purely additive: RLS policies on
  content's `posts`/`votes`, a per-request GUC-binding helper, one new falsifiable claim
  (`rls-blocks-broken-service-layer`) with one deliberate-bug toggle (`CONTENT_BUG_DISABLE_RLS`) and a
  matrix entry. It **weakens no existing claim, schema, or falsifier**: the `tenant-isolation` property
  and its `CONTENT_BUG_TENANT_LEAK` toggle are untouched, and the service-layer filter remains the
  always-on primary guard. Per the repo's invariant rule, a red introduced here is a finding to fix,
  never a rule to loosen.
- **Relates to:** Commitment 9 (communities-as-tenants, the boundary this hardens),
  [ADR-0024](0024-verifiable-invariants-single-source-enforced-at-the-boundary.md) (the
  derive-from-one-source discipline — the GUC name and the fail-open predicate are each defined once and
  reused), [ADR-0028](0028-in-process-tenant-span-gate-primary-live-audit-corroboration.md) (the
  in-process-primary shape this follows: the keyless in-proc gate is the teeth, a deployed cluster is
  corroboration), and the `tenant-isolation` claim it sits beneath.

## Context

QARoom's tenancy isolation (Commitment 9) was, until this card, **service-layer only**. Every
repository read applies a `community_id` `WHERE` filter — `services/content/src/repository/posts.ts`
scopes `listFeed` to one community, and the `tenant-isolation` property test (a three-tenant
interleave) proves it. The deliberate-bug toggle `CONTENT_BUG_TENANT_LEAK` loosens that `WHERE` to
`sql\`true\``, and the property reds: the service guard is real and falsifiable.

But there was **exactly one** layer. Nothing in the database stopped a leak if that single `WHERE`
were wrong — a refactor, a missed filter on a new query, an agent patching around the gate
([ADR-0032](0032-agentic-development-as-a-tested-boundary.md)). `CONTENT_BUG_TENANT_LEAK` can prove the
service guard works; it **cannot** prove a second layer exists, because there wasn't one. That is the
genuine architectural gap this ADR closes — not a missing test, a missing layer.

## Decision

### 1. RLS policies on content's tenant tables (`posts`, `votes`)

`ensureSchema` applies, after the tables exist (idempotently, on every boot/test),
`ENABLE` + `FORCE ROW LEVEL SECURITY` and a `community_id`-scoped policy per tenant table
(`services/content/src/db/rls.ts`). `posts` keys directly on `community_id`. `votes` carries no
`community_id`, so its policy joins through `post_id → posts.community_id`; that inner read is itself
RLS-scoped, so the `EXISTS` only ever sees in-tenant posts. The policy SQL is derived once
(`failOpenCommunityMatch`, `RLS_COMMUNITY_GUC`) and reused, so the `USING` and `WITH CHECK` clauses
cannot drift (the ADR-0024 discipline).

### 2. Binding the request's community (transaction-local GUC)

The policies key on a session GUC, `app.current_community_id`. `withCommunityScope(db, communityId, fn)`
opens a transaction, runs `set_config('app.current_community_id', communityId, true)` —
**`is_local = true`**, so the GUC is scoped to that transaction and reset at `COMMIT`/`ROLLBACK` — and
runs `fn`. A pooled connection therefore never carries one request's tenant into the next. `listFeed`
runs inside this scope; the per-community `WHERE` stays in place as the primary guard, and RLS activates
underneath it.

> Note on placement. The card suggested binding the GUC "in `service-kit` DB acquisition". `service-kit`
> is **deliberately DB-free** (its `AGENTS.md`: no postgres/drizzle dependency, so the DB-less gateway
> reuses the same shell), and the per-request community context isn't available at connection time
> anyway. The faithful home is the per-service DB layer; `withCommunityScope` is content's
> implementation and the reusable shape every other service follows to activate its own policies.

### 3. Fail-open when unbound — defence in depth, never a new failure mode

`current_setting('app.current_community_id', true)` returns `NULL` for an unbound GUC; the policy then
admits **every** row. RLS is therefore pure defence-in-depth: it can only ever **hide** a cross-tenant
row a bound request should not see, never invent a "returns zero rows" failure mode for a query that
forgot to bind (system/admin reads — e.g. the `/system/state` cross-tenant `countRows` — keep working).
The cost is honestly stated: a query that forgets to bind falls back to the service-layer guard alone.
The service `WHERE` is the always-on primary; RLS is the backstop that bites once a tenant context is
bound.

### 4. The catch-broken-service test + claim (the headline)

`services/content/tests/rls-second-layer.spec.ts` proves the second layer **in-process (Tier-A)**. It
removes the service filter entirely — `SELECT … WHERE true`, the worst broken-service case — and asserts
the database still returns only the bound community's rows. The new claim
`rls-blocks-broken-service-layer` (toggle `CONTENT_BUG_DISABLE_RLS`) makes it falsifiable: armed,
`ensureSchema` skips the policies, the broken read leaks the other tenant, and
`pnpm prove rls-blocks-broken-service-layer --break` turns the gate RED.

## The PGlite RLS finding (what set the tier)

Before designing the test we spiked whether PGlite (the in-process WASM Postgres the whole suite runs
on) actually **enforces** RLS or merely parses the DDL. The finding, and it is the crux of the tier:

- **PGlite enforces RLS exactly like server Postgres.** It reports `PostgreSQL 16.4`; the catalog flags
  (`relrowsecurity`, `relforcerowsecurity`), `pg_policies`, and per-row predicate evaluation are all
  correct.
- **The superuser/owner bypasses RLS — even under `FORCE`.** PGlite connects as the `postgres`
  superuser, which (standard Postgres semantics) bypasses row security. So a naive in-process read
  returns *all* rows and *looks* like RLS does nothing. It is not a PGlite limitation; it is the same
  rule a real deployment lives under.
- **Under a non-superuser role, RLS bites.** `CREATE ROLE … ; GRANT … ; SET ROLE …`, bind the GUC, and
  the policy filters correctly. A deployed content-service connects as a non-superuser application role,
  which is precisely the role RLS protects.

So the catch-broken-service gate runs **in-process under `SET ROLE`** — a genuine Tier-A claim, no
cluster required. (Had PGlite only parsed RLS, the migration would still have been correct for the real
cluster and the gate would have been **named Tier-B**, falsifiable only in-cluster. It did not come to
that.) This finding is itself the pedagogical payoff: the superuser-bypass gotcha is the single most
common way real RLS deployments silently provide no protection.

## Why RLS was not in the original design

Two honest reasons, both recorded here so a future reader does not mistake the absence for an oversight:

1. **Pedagogical clarity — prove one layer before adding a second.** The QARoom story is "a testing
   architecture": each boundary gets *one* defended guard first, demonstrably falsifiable, before any
   defence-in-depth is layered on. Tenancy's first guard is the service-layer `WHERE`, proven by
   `tenant-isolation`. A second layer only *teaches* something once the first is established as the
   thing being backstopped — the demonstration here is literally "the service layer is broken, and the
   database catches it", which is only legible against an already-proven service layer.
2. **RLS is invisible in-process unless you deliberately role-switch.** Because the harness connects as
   the superuser, RLS would have sat dormant and untested under every existing test (superuser bypass),
   giving false confidence. It needed its own non-superuser test seam to mean anything — which is what
   this card builds.

## Scope: content is the proven exemplar; the fleet is a documented follow-up

The other tenant tables (`flags`/`flag_cache`, `donations`, `webhook_subscriptions`/
`webhook_deliveries`, identity `memberships`) all carry a `community_id` column and the same fail-open
policy DDL applies mechanically. This ADR **deliberately implements RLS only for content**, fully wired
and Tier-A-proven, and documents the fleet extension as a per-service follow-up rather than shipping
policy DDL everywhere now. The reason is not laziness but honesty:

- A policy without a per-request **GUC binding** is, by the fail-open contract, **inert** — it never
  bites. Shipping inert policies to four services would be exactly the "looks-like-protection,
  never-fires" theater this repo exists to refute.
- The **superuser-bypass** means fleet-wide RLS is **untestable in-process** without a per-service
  non-superuser role-switch test. Untested, dormant policies are worse than none.

Activating RLS for another service is therefore a real, testable unit of work: add its policy DDL, bind
the GUC in its tenant read path (its `withCommunityScope` equivalent), and add its own
catch-broken-service test under `SET ROLE`. Content is the worked example.

## Consequences

- **Tenancy now has two independent layers**, and the second is falsifiable in-process. A broken
  service `WHERE` on content's feed no longer leaks across tenants on a non-superuser deployment.
- **No behavioural change to existing tests.** Under the superuser harness RLS is bypassed and the
  transaction-local GUC is a no-op, so every existing content test (including `tenant-isolation`) is
  byte-for-byte unaffected; only the new role-switching test exercises the policies.
- **A documented residual:** RLS only protects content today, and only when the service connects as a
  non-superuser role with the GUC bound (both true on the deployed cluster, neither true under the
  superuser test harness except in the dedicated test). The fleet rollout is named above.

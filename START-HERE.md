# Start here

QARoom is a large repo — many services, a lot of tests, 40-odd decision records. This page is the fast way
in: what to open, what to run, and what each thing is *for*, sorted by how much time you have. Read it top to
bottom or jump to your budget.

The three anchors everything else hangs off: the [README](README.md) makes the case, [ARCHITECTURE.md](ARCHITECTURE.md)
is the whole system + how it's tested on one page, and the [live walkthrough](https://mariusargatu.github.io/QARoom/)
is a no-install tour in plain English. This page is the guided version, with a stopwatch.

Everything in the first two paths runs **JS-only** — `pnpm install` is the only prerequisite. No Docker, no
cluster, no API keys. (What needs more is spelled out in the [cold-start guide](#cold-start-what-runs-without-docker).)

---

## Pick a budget

| You have | Do this |
|---|---|
| **5 minutes** | The smoke test ↓ — see a real test catch a real bug |
| **30 minutes** | The technical read ↓ — the architecture and how it's tested |
| **90 minutes** | The deep dive ↓ — pull on whatever you want to pressure-test |

---

## 5 minutes — the smoke test

The whole idea is *"a test you can't make fail isn't protecting you."* Watch it hold up on your machine:

```bash
pnpm install
pnpm prove webhook-signing --break   # arms a real bug; a real test must go RED
```

You should see `✗ GATE RED: the guarantee test FAILED, the toggle was caught.` — that's a deliberately
planted bug (signing the body but not the timestamp) being caught by the webhook signing test, live. Then:

1. Look at the **hero image** on the [README](README.md) — the detection matrix. It leads with the bugs each
   technique *misses* (the honest cells), not just what it catches.
2. Skim [`docs/detection-matrix.md`](docs/detection-matrix.md) — every seeded bug × every technique.

---

## 30 minutes — the technical read

1. **[ARCHITECTURE.md](ARCHITECTURE.md)** — the 2-minute plain summary at the top, then **§3, the boundary
   map**: the idea that every boundary has a categorical failure mode and one named technique that defends it.
   That map is the spine of the repo.
2. **[`docs/code-tour.md`](docs/code-tour.md)** — one request (`POST …/posts`) followed hop by hop from the
   client edge to Postgres, each hop naming the boundary it crosses and the test that guards it, with
   clickable `file:line` anchors.
3. **[`docs/adr/README.md`](docs/adr/README.md)** — the decision records, each paired with the alternatives it
   *rejected*. Open any two that catch your eye (e.g. [ADR-0040](docs/adr/0040-trigger-scoped-ci-pipeline.md),
   trigger-scoped CI).
4. **Break a couple more claims.** `pnpm prove` (bare) lists them all; `--break` any that interest you —
   `pnpm prove tenant-isolation --break`, `pnpm prove vote-value-in-set --break`.

---

## 90 minutes — the deep dive

Do the 30-minute path, then follow whichever threads below matter to you, plus:

- **Run the whole in-process suite:** `pnpm test` — no Docker; an in-process Postgres (PGlite) runs inside
  the test process.
- **Read one service end to end:** [`services/content`](services/content/) — boot (`src/server.ts`), wiring
  (`src/app.ts`), routes, repository, and its co-located `*.test.ts` / `*.spec.ts` / `*.property.test.ts`.
- **The judgment layer:** [`docs/operating-model.md`](docs/operating-model.md) (where this discipline costs
  and where it's the wrong choice) and [`docs/gauntlet.md`](docs/gauntlet.md) (gate vs observe for the
  expensive lanes).

---

## A map by topic

If you care about one thing in particular, go straight to it. Each row is something you can open or run.

### Testing & quality

| Topic | Where to look |
|---|---|
| Tests that catch real bugs (not coverage) | `pnpm prove <id> --break` · [`docs/detection-matrix.md`](docs/detection-matrix.md) · Stryker mutation gate (`pnpm stryker:critical`) |
| Testing the non-deterministic (LLM) | [`services/moderator-agent`](services/moderator-agent/) — safety *invariants* (never confidently approve a flagged item; abstain when unsure; ignore injected instructions) rather than pinning one exact answer |
| One technique per boundary | [ARCHITECTURE.md](ARCHITECTURE.md) §3 · [`docs/code-tour.md`](docs/code-tour.md) |
| Contract testing across services | Pact v4 consumer tests in `services/<consumer>/tests/contracts/` · `pnpm openapi:verify` · `oasdiff` breaking-change gate |
| Property & model-based testing | `*.property.test.ts` (fast-check) · XState machines in [`packages/contracts/src/machines`](packages/contracts/) · reverse-conformance vs live spans |
| Cost / risk judgment on test tiers | [`docs/gauntlet.md`](docs/gauntlet.md) · [`docs/operating-model.md`](docs/operating-model.md) |
| Honesty about gaps | [`docs/detection-matrix.md`](docs/detection-matrix.md) leads with misses · [`docs/claims.md`](docs/claims.md) |

### System & engineering

| Topic | Where to look |
|---|---|
| Design for testability | [`packages/determinism`](packages/determinism/) — injected `Clock` / `IdGenerator` / `Randomness`; lint rules `qaroom/no-new-date`, `qaroom/no-unseeded-random` |
| Single source of truth, derived everywhere | [`packages/contracts`](packages/contracts/) (Zod) → generated OpenAPI, DB shape, property generators · [`docs/getting-started.md`](docs/getting-started.md) |
| Convention as a gate, not prose | [`tools/eslint-plugin-qaroom`](tools/eslint-plugin-qaroom/index.js) · the drift gates (`pnpm claims:verify`, `pnpm openapi:verify`, `pnpm mcp:verify`) |
| Distributed-systems correctness | `@qaroom/messaging` — outbox, `processed_events` dedup, idempotency · [ADR-0011](docs/adr/0011-async-dedup-outbox-msgid-processed-events.md) |
| Observability as a test surface | [`packages/otel`](packages/otel/) — `tenant.id` span processor · Tracetest assertions · the in-process tenant-span gate |
| Pragmatic infrastructure | k3d + Tilt + shared Helm chart ([`packages/helm-template`](packages/helm-template/)) · trigger-scoped CI ([ADR-0040](docs/adr/0040-trigger-scoped-ci-pipeline.md)) |
| Decisions and their trade-offs | [`docs/adr/`](docs/adr/README.md) — each with rejected alternatives; [ADR-0001](docs/adr/0001-foundational-decisions.md) is immutable |

---

## Cold-start: what runs without Docker

So you never hit a confusing wall — `pnpm prove` lists every claim; here's what each group needs:

| Group | Prerequisite | Notes |
|---|---|---|
| `pnpm test`, `pnpm prove`, and most claims (webhooks, content, gateway, web, messaging, otel, identity, …) | `pnpm install` only | Pure Node + PGlite (in-process Postgres). This is the whole 5- and 30-minute experience. |
| The moderator / input-guard claims (`moderator-*`, `input-guard-*`, `retrieved-context-fenced`) | `uv` (Python) | These run a `pytest` gate. Without `uv`, `pnpm prove … --break` honestly reports **"GATE DID NOT RUN"** and exits non-zero — a missing prerequisite is never mislabeled as a pass. |
| The live claims (`tenant-span-everywhere`, `outbox-isolates-broker-latency`), `pnpm dev`, `pnpm gauntlet` live phases | Docker + local cluster | These exercise the running system. Not needed to read the code. |

The tooling is deliberately honest about this: a gate that *couldn't run* (missing `uv`, an unreachable
target) is reported as **"gate could not run"**, distinct from a claim that was **falsified** — see
[`scripts/prove.ts`](scripts/prove.ts).

---

## Where to go next

- [README.md](README.md) — the pitch and the 30-second proof.
- [ARCHITECTURE.md](ARCHITECTURE.md) — system + testing + decisions on one page.
- [docs/README.md](docs/README.md) — a map of every document, grouped by purpose.
- [docs/adr/README.md](docs/adr/README.md) — the decisions and their rejected alternatives.

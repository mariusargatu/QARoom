<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/detection-matrix-dark.svg">
  <img alt="QARoom detection matrix: every seeded bug down the side, every testing technique across the top, each cell marked catch or — honest miss. Most cells are misses, on purpose." src="docs/assets/detection-matrix-light.svg" width="100%">
</picture>

# QARoom · testability as an architectural property

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/mariusargatu/QARoom/ci.yml?branch=main&label=CI)](https://github.com/mariusargatu/QARoom/actions)
[![Live demo](https://img.shields.io/badge/demo-live-EAB24E)](https://mariusargatu.github.io/QARoom/)

A multi-tenant social platform (communities, posts, votes, donations) built as a working demonstration that **testability can be an architectural property, not a phase**. The system is shaped to be tested; the tests are shaped to its boundaries. Neither is bolted on.

## Why look at this repo?

- **Testability is designed in, not bolted on.** Every architectural choice exists to expose a seam a specific testing technique needs — the whole reasoning on one page: **[ARCHITECTURE.md](ARCHITECTURE.md)**.
- **Don't trust the green check — falsify it.** Every claim ships with the bug that breaks it and the test that catches it. `pnpm prove <id> --break` turns a real test red on demand: **[docs/claims.md](docs/claims.md)**.
- **An honest detection matrix.** The hero image above is real and drift-gated: bug × technique, and most cells are deliberate *misses* — coverage theater is the thing this repo refuses to perform: **[docs/detection-matrix.md](docs/detection-matrix.md)**.
- **One source, derived everywhere.** Zod is the single contract; OpenAPI, AsyncAPI, the DB constraints, and the property generators are all generated from it, and drift fails loudly: **[ARCHITECTURE.md §4](ARCHITECTURE.md#4-why-the-contracts-cant-quietly-lie-triangulation)**.

## Try it (lightest first)

**1 · See it live — zero install →** **[mariusargatu.github.io/QARoom](https://mariusargatu.github.io/QARoom/)**
A one-page, plain-English overview: the well-known kinds of software testing (unit, integration, end-to-end, contract, load, security, and AI), each with one real example from the app — from vote tallying to webhook security to AI moderation.

**2 · Run the whole test suite — no Docker.** Postgres runs in-process via PGlite, so the suite runs in seconds:

```bash
pnpm install
pnpm demo            # full suite (in-process PGlite) + a rendered summary; no Docker
pnpm prove           # list the falsifiable claims; `pnpm prove <id> --break` turns one red
```

**3 · Bring up the full architecture — needs Docker.**

<details>
<summary>Every service, the NATS bus, and the Grafana / Jaeger / Prometheus stack on a local k3d + Tilt cluster</summary>

```bash
# Docker must be running
pnpm dev          # k3d + Tilt: the full architecture
pnpm dev:down     # tear it all back down
```

**Resource warning:** this starts a ~15-pod cluster with its own observability stack, so give Docker at least 8 GB of RAM and 4 CPUs, or not everything will come up.

The full orchestrated [gauntlet](docs/gauntlet.md) (`pnpm gauntlet`) adds the real-model tiers. Test numbers are read from a CI run's `test-results/summary.json`, never typed by hand.

</details>

## Where to start

- **[ARCHITECTURE.md](ARCHITECTURE.md)**: the system, the testing, and the reasoning for each, on one page — and the map of where every other truth lives.
- **The model site** ([mariusargatu.github.io/QARoom/architecture](https://mariusargatu.github.io/QARoom/architecture/)): the living C4 + testing diagrams and the decision log, generated from [`docs/structurizr/`](docs/structurizr/).
- **The evidence**: the [detection matrix](docs/detection-matrix.md) (most cells are honest *misses*), the [claims](docs/claims.md) (the dare), the [gauntlet](docs/gauntlet.md); decisions in [`docs/adr/`](docs/adr/).
- **[AGENTS.md](AGENTS.md)**: the front door for LLM agents (with `/system/capabilities` and the qaroom-mcp tool surface).

## License

MIT for the code ([LICENSE](LICENSE)). CC-BY for the writing under `docs/`.

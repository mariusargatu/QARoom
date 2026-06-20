# QARoom · testability as an architectural property

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/mariusargatu/QARoom/ci.yml?branch=main&label=CI)](https://github.com/mariusargatu/QARoom/actions)
[![Live demo](https://img.shields.io/badge/demo-live-EAB24E)](https://mariusargatu.github.io/QARoom/)

> [!NOTE]
> QARoom is a multi-tenant social platform (communities, posts, votes, donations) built as a working demonstration that **testability can be an architectural property, not a phase**. The system is shaped to be tested; the tests are shaped to its boundaries. Neither is bolted on. The mental model on one page: **[ARCHITECTURE.md](ARCHITECTURE.md)**.

## See it live → [mariusargatu.github.io/QARoom](https://mariusargatu.github.io/QARoom/)

A one-page, plain-English overview: the well-known kinds of software testing (unit, integration, end-to-end, contract, load, security, and AI), each with one real example from the app, from vote tallying to webhook security to AI moderation.

## Run it

Bring the whole system up locally (every service, the NATS bus, and the Grafana, Jaeger, and Prometheus dashboards) on a small k3d + Tilt cluster:

```bash
# Docker must be running
pnpm dev          # k3d + Tilt: the full architecture
pnpm dev:down     # tear it all back down
```

**Resource warning:** this starts a ~15-pod cluster with its own observability stack, so give Docker at least 8 GB of RAM and 4 CPUs, or not everything will come up.

Just want the tests? No Docker needed: Postgres runs in-process via PGlite, so the whole suite runs in seconds.

```bash
pnpm install
pnpm test            # full suite, no Docker (in-process PGlite)
pnpm claims:verify   # every front-door claim is breakable on demand; nothing can go stale
```

The full orchestrated [gauntlet](docs/gauntlet.md) (`pnpm gauntlet`) adds the real-model tiers. Test numbers are read from a CI run's `test-results/summary.json`, never typed by hand.

## Where to start

- **[ARCHITECTURE.md](ARCHITECTURE.md)**: the system, the testing, and the reasoning for each, on one page — and the map of where every other truth lives.
- **The model site** ([mariusargatu.github.io/QARoom/architecture](https://mariusargatu.github.io/QARoom/architecture/)): the living C4 + testing diagrams and the decision log, generated from [`docs/structurizr/`](docs/structurizr/).
- **The evidence**: the [detection matrix](docs/detection-matrix.md) (most cells are honest *misses*), the [claims](docs/claims.md) (the dare), the [gauntlet](docs/gauntlet.md); decisions in [`docs/adr/`](docs/adr/).
- **[AGENTS.md](AGENTS.md)**: the front door for LLM agents (with `/system/capabilities` and the qaroom-mcp tool surface).

## License

MIT for the code ([LICENSE](LICENSE)). CC-BY for the writing under `docs/`.

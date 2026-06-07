# Service Level Objectives

This document mirrors the SLO table in `docs/03-testing-strategy.md` §12 and is the
single place to look up an endpoint's performance target. The numbers are introduced as
a **skeleton in Milestone 0** and **exercised by k6 against the local k3d cluster in Milestone 8**.
Documenting them upfront means every endpoint added in Milestones 1–7 has a target it must
meet before it lands, and "SLO regression" becomes a defined failure mode in the load
milestone.

> Treat the numbers as teaching values. They exist so SLO regression is testable in
> Milestone 8, not because QARoom claims production-grade reliability. Availability is
> measured against the local k3d cluster during the demo window, not a real production.

## Targets

| Endpoint | Latency p50 / p95 / p99 | Error rate | Availability |
|---|---|---|---|
| `POST /api/communities/{id}/posts` | 50 / 200 / 500 ms | < 0.5% | 99% |
| `GET /api/communities/{id}/feed` | 30 / 100 / 300 ms | < 0.1% | 99% |
| `POST /api/posts/{id}/votes` | 40 / 150 / 400 ms | < 1% | 99% |
| `POST /api/communities/{id}/donations` | 200 / 800 / 2000 ms | < 1% | 99% |
| `GET /system/state` | 20 / 80 / 200 ms | < 0.1% | 99% |
| `GET /system/snapshot` | unbounded | < 1% | best-effort |

## Milestone 0 status

Of the endpoints above, content-service implements `POST /api/communities/{id}/posts`,
`GET /api/communities/{id}/feed`, `POST /api/posts/{id}/votes`, and `GET /system/state`
today. The donations and snapshot endpoints arrive in later milestones (5 and 7). No load
test enforces these numbers yet: that is Milestone 8 (`k6` vs these SLOs).

## Milestone 3: observability online

These targets are now **observable** (not yet **enforced**: enforcement is Milestone 8 `k6`).
Every service exports OTLP to the OpenTelemetry Collector, which fans traces out to Jaeger
and metrics to Prometheus (scraped from the Collector's prometheus exporter on `:8889`);
Grafana provisions both as datasources. The metrics that back these rows, request count
and a duration histogram keyed by `service.name` and `tenant.id`, surface through the
Collector the moment a service emits them, and the Prometheus scrape config already covers
per-service `/metrics` (pod-annotation discovery) for when that lands. Every span also
carries `tenant.id`, so latency/error rates are sliceable per community.


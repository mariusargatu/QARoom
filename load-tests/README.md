# Load tests (k6 vs SLOs) — Milestone 8

k6 scripts that enforce the SLO table in [`docs/slos.md`](../docs/slos.md). Thresholds are not
hand-written here: `SLO_TARGETS` in `packages/contracts/src/slos.ts` is the single source of truth
(pinned to the doc by `slos.test.ts`), projected to `lib/slo-thresholds.gen.json` by
`pnpm k6:gen`. A breached threshold makes k6 exit **99** (`ThresholdsHaveFailed`) — that is the gate.

Latency is gated on **`http_req_waiting`** (TTFB ≈ server processing time), not `http_req_duration`,
so the measurement tracks the service, not the runner's send/receive noise. Each script splits load
into a `warmup` scenario and a `measure` scenario; thresholds apply only to `{scenario:measure}`.

## Scripts

| Script | Endpoint | Stack needed | CI lane |
|---|---|---|---|
| `vote-cast.js` | `POST /api/posts/{id}/votes` (write-heavy) | content-service only | merge-to-main (gated) |
| `feed.js` | `GET /api/communities/{id}/feed` (read-heavy) | content-service only | merge-to-main (gated) |
| `donation.js` | `POST /api/communities/{id}/donations` | full stack: donations + payment mock + `donations` flag **enabled** | local / full-stack only |

`vote-cast` and `feed` need only content-service (no gateway/auth), so they run in the CI `load` job.
`donation` needs the donations stack and the `donations` flag enabled for the community — run it
against the local cluster (`pnpm dev`) after enabling the flag; it is intentionally not in the
minimal CI lane.

## Run locally

```bash
# generate thresholds from SLO_TARGETS (idempotent; commit the result)
pnpm k6:gen

# start content-service (or `pnpm dev` for the full cluster), then:
k6 run load-tests/vote-cast.js -e CONTENT_BASE_URL=http://localhost:8081
k6 run load-tests/feed.js      -e CONTENT_BASE_URL=http://localhost:8081

# fold the k6 summaries into test-results/summary.json
pnpm k6:results
```

## The SLO-breach exit criterion (deliberate slow path)

`castVote` carries an env-gated slow path (`CONTENT_BUG_VOTE_SLOW_MS`, see
`services/content/src/repository.ts`). Restart content with it set and the vote SLO breaches:

```bash
# green: clean run passes
k6 run load-tests/vote-cast.js

# red: 800ms injected into the vote write path → http_req_waiting p95 breaches → k6 exits 99
CONTENT_BUG_VOTE_SLOW_MS=800  # set on the content-service process, then:
k6 run load-tests/vote-cast.js   # exit code 99
```

## Knobs (env)

- `K6_SLO_MULTIPLIER` — widen all latency thresholds (CI sets `3` to absorb shared-runner variance;
  the slow-path negative test is the hard proof of sensitivity).
- `K6_RATE`, `K6_WARMUP_RATE`, `K6_DURATION`, `K6_SEED_POSTS` — load shape.
- `CONTENT_BASE_URL`, `DONATIONS_BASE_URL` — targets.

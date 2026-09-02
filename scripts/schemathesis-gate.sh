#!/usr/bin/env bash
#
# Schema-driven fuzzing gate (Milestone 1, trust boundary). Runs Schemathesis from its
# official container against a running service's committed OpenAPI — so there is no
# Python in the monorepo. `--checks all` includes `not_a_server_error` (any 5xx fails
# the gate) and response/schema conformance.
#
# Usage: scripts/schemathesis-gate.sh [spec-dir] [base-url]
set -euo pipefail

SPEC_DIR="${1:-services/gateway}"
BASE_URL="${2:-http://host.docker.internal:8080}"

# Single fuzz budget for PR-CI (kept low to protect the docs/03 §8 PR-CI-fast latency
# window; the broad nightly budget is the Milestone 8 home, docs/03 §8). Override only for
# local exploration via the 3rd positional arg.
MAX_EXAMPLES="${3:-12}"

# Optional pacing (gauntlet finding, 2026-06-10): fuzzing THROUGH the gateway's rate limiter
# at a broad budget drains the token bucket, and the positive/negative conformance checks then
# misread the fuzzer's own 429s as contract violations (valid → "rejected schema-compliant",
# invalid → throttled before validation → "accepted schema-violating"). Set
# SCHEMATHESIS_RATE_LIMIT (e.g. 8/s, under the documented 10/s refill) for limiter-guarded
# targets; direct-service targets don't need it.
RATE_ARGS=()
if [[ -n "${SCHEMATHESIS_RATE_LIMIT:-}" ]]; then
  RATE_ARGS=(--rate-limit "${SCHEMATHESIS_RATE_LIMIT}")
fi

# Optional path exclusion, for operations whose UPSTREAM this lane deliberately does not boot. Every
# 5xx is a gate failure (`not_a_server_error`), and a proxy route whose upstream is absent answers
# 502 `dependency_failure` — correct behaviour reported as a bug. The honest fix is to boot the
# upstream; where that is out of the lane's reach the operation must be EXCLUDED and named, not left
# to fail. Set SCHEMATHESIS_EXCLUDE_PATH_REGEX and say why at the call site.
EXCLUDE_ARGS=()
if [[ -n "${SCHEMATHESIS_EXCLUDE_PATH_REGEX:-}" ]]; then
  EXCLUDE_ARGS=(--exclude-path-regex "${SCHEMATHESIS_EXCLUDE_PATH_REGEX}")
fi

# Phases are explicit so the gate's intent is legible (Spike 2, docs/spikes/02): besides
# `fuzzing`, the `stateful` phase FOLLOWS the OAS `links` the generator emits on every
# mutating endpoint (createPost→getPost, castVote→getPost). Link-following is
# Schemathesis's unique value over Pact — it tests sequences, not single calls — so the
# gate would be a stateless smoke test without it.
#
# NO static `Idempotency-Key` header (2026-08-11). It used to be pinned here so mutations
# would reach 2xx, but `withIdempotency` keys replay on (key, route, body_hash) and answers
# a REUSED key carrying a DIFFERENT body with 409 — thrown before `produce()` runs. The
# fuzzer varies bodies by design, so after the first successful mutation per route every
# later one short-circuited at the idempotency layer without touching a repository, the
# outbox, or the DB. 409 is a declared response, so conformance passed and the gate stayed
# green while testing almost nothing. Measured against content-service:
#
#   with the static header:     329 cases, gate green,   1 post +  1 vote persisted
#   without it (this command):  759 cases, gate green, 103 posts + 59 votes persisted
#
# Schemathesis generates the header itself — every mutating operation already declares
# `Idempotency-Key` as a required header parameter in its OAS (the two `/ws/tickets` posts
# genuinely take no key, and correctly do not declare one). Do not re-pin it: a fixed key
# silently converts this gate back into a one-request-per-route smoke test. Schemathesis
# had in fact been reporting the collapse all along, as the "operations mostly rejected
# generated data" warning on POST /api/communities/{communityId}/posts.
#
# `unsupported_method` is excluded deliberately: Fastify answers unknown methods
# (e.g. TRACE) with our RFC 7807 404 rather than 405 — a best-practice nicety, not a
# correctness fault, and 405-for-all-paths is extra plumbing we are not adding in Milestone 1.
# Every other check (incl. `not_a_server_error` and response conformance) still runs.
# `--add-host` makes `host.docker.internal` resolve on Linux CI runners too (it is a
# no-op on Docker Desktop, where the alias already exists).
docker run --rm --add-host=host.docker.internal:host-gateway -v "$(pwd)/${SPEC_DIR}:/spec:ro" schemathesis/schemathesis:stable run \
  /spec/openapi.yaml \
  --url "${BASE_URL}" \
  --checks all \
  --exclude-checks unsupported_method \
  --phases examples,coverage,fuzzing,stateful \
  --max-examples "${MAX_EXAMPLES}" ${RATE_ARGS[@]+"${RATE_ARGS[@]}"} ${EXCLUDE_ARGS[@]+"${EXCLUDE_ARGS[@]}"}

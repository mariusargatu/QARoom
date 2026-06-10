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

# Phases are explicit so the gate's intent is legible (Spike 2, docs/spikes/02): besides
# `fuzzing`, the `stateful` phase FOLLOWS the OAS `links` the generator emits on every
# mutating endpoint (createPost→getPost, castVote→getPost). Link-following is
# Schemathesis's unique value over Pact — it tests sequences, not single calls — so the
# gate would be a stateless smoke test without it. The static `Idempotency-Key` header
# lets mutations reach 2xx so the links can resolve.
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
  --header "Idempotency-Key: schemathesis-gate" \
  --max-examples "${MAX_EXAMPLES}" ${RATE_ARGS[@]+"${RATE_ARGS[@]}"}

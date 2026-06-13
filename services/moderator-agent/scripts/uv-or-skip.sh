#!/usr/bin/env bash
# Turbo-passthrough guard: `pnpm test` must not hard-fail on machines without uv (the one Python
# toolchain, ADR-0018). With uv present this is a transparent `uv run "$@"`. Without it: in CI
# (CI=true) uv is mandatory — exit 1; locally it degrades to a RECORDED skip — visible message,
# exit 0, and a skip marker written in the pytest-summary shape scripts/moderator-results.ts
# reads (skip_reason mirrors the gauntlet's skipReason: 'uv not installed' prior art).
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v uv >/dev/null 2>&1; then
  exec uv run "$@"
fi

if [ "${CI:-}" = "true" ]; then
  echo "✗ moderator-agent: uv is required in CI — install: https://docs.astral.sh/uv/" >&2
  exit 1
fi

mkdir -p test-results
printf '{\n  "passed": 0,\n  "failed": 0,\n  "skipped": 0,\n  "skip_reason": "uv not installed"\n}\n' \
  > test-results/pytest-summary.json
echo "⊘ moderator-agent: suite SKIPPED — uv not installed (install: https://docs.astral.sh/uv/)."
echo "  Recorded in services/moderator-agent/test-results/pytest-summary.json; CI=true hard-fails."

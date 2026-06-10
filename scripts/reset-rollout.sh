#!/usr/bin/env bash
#
# Walk a flag's rollout machine back to Off via its own modeled reverse/abort edges, so the
# Tracetest rollout-transition def (which sends EnableRequested — legal only from Off) is
# idempotent across repeated runs. Gauntlet finding (2026-06-10): each successful def run
# consumes one Advance edge; enough reruns park the machine where EnableRequested is a 409 and
# the def fails on MISSING transition spans — state-machine-mutating trace tests are not
# idempotent unless something resets the machine.
#
#   scripts/reset-rollout.sh http://localhost:18083 [community] [flagKey]
set -euo pipefail

BASE="${1:?usage: reset-rollout.sh <flags-base-url> [community] [flagKey]}"
COMMUNITY="${2:-comm_00000000000000000000000000}"
FLAG="${3:-donations}"

state_of() {
  curl -fsS "${BASE}/api/communities/${COMMUNITY}/flags/${FLAG}" |
    python3 -c "import sys,json;print(json.load(sys.stdin)['state'])"
}

advance() {
  curl -fsS -X POST "${BASE}/api/communities/${COMMUNITY}/flags/${FLAG}/rollout" \
    -H 'Content-Type: application/json' -H "Idempotency-Key: reset-$1-$RANDOM" \
    -d "{\"event\":\"$1\"}" >/dev/null
}

# state → the single modeled event that moves toward Off (rollout.machine.ts).
for _ in 1 2 3 4; do
  state="$(state_of)"
  case "$state" in
    Off)
      echo "✓ rollout '${FLAG}' is Off"
      exit 0
      ;;
    Enabling | Canary) advance RolloutAborted ;;
    Enabled) advance DisableRequested ;;
    Disabling) advance DisableCompleted ;;
    *)
      echo "✗ unknown rollout state '${state}'" >&2
      exit 1
      ;;
  esac
done
echo "✗ rollout '${FLAG}' did not reach Off (last state: $(state_of))" >&2
exit 1

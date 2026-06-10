#!/usr/bin/env bash
#
# Replay a captured scenario INTO the live cluster with its bundled chaos manifests reapplied,
# then assert trace shape under those exact conditions — "a bug that exists only under
# chaos+state is now a regression test" (seam A of the max-out program; Commitment 6 made
# literal). Healing is owned HERE via trap, not by the loader.
#
#   scripts/replay-under-chaos.sh <scenario> [tracetest-def.yaml ...]
#
# Targets the LIVE in-cluster services (POST /system/snapshot restore is unguarded, ADR-0009);
# production clock is kept — fine for chaos/latency/trace-shape assertions, not for
# clock-sensitive scenarios (those stay on the compose replay path).
set -uo pipefail

SCENARIO="${1:?usage: replay-under-chaos.sh <scenario> [tracetest-def.yaml ...]}"
shift
DEFS=("$@")

heal() {
  echo "→ healing bundled chaos manifests"
  local dir="scenarios/${SCENARIO}/chaos"
  if [[ -d "$dir" ]]; then
    for f in "$dir"/*.yaml; do
      kubectl delete -f "$f" --ignore-not-found >/dev/null 2>&1 || true
    done
  fi
}
trap heal EXIT

# Replay targets = the live Services, port-forwarded onto the *_REPLAY_URL default ports.
FWD="content:18091:80,identity:18092:80,flags:18093:80,donations:18094:80"

bash scripts/with-port-forward.sh "$FWD" -- \
  pnpm replay:load "$SCENARIO" --chaos
LOAD_EXIT=$?
if [[ $LOAD_EXIT -ne 0 ]]; then
  echo "✗ replay:load --chaos failed (exit ${LOAD_EXIT})" >&2
  exit "$LOAD_EXIT"
fi

if [[ ${#DEFS[@]} -eq 0 ]]; then
  echo "✓ scenario loaded under its captured chaos — no tracetest defs requested"
  exit 0
fi

bash scripts/with-port-forward.sh observability/qaroom-tracetest:11633:11633 -- \
  env TRACETEST_SERVER_URL=http://localhost:11633 pnpm tracetest:results "${DEFS[@]}"

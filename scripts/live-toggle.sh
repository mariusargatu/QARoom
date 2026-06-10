#!/usr/bin/env bash
#
# Arm a deliberate-bug env toggle on live in-cluster deployment(s), run a gate command, then
# ALWAYS revert — the live-tier counterpart of `pnpm prove <id> --break` (which only sets the
# toggle on the gate process). Built for the detection-matrix cluster tier and live-tier claims;
# any future live toggle reuses this instead of hand-rolling kubectl choreography.
#
# Usage: scripts/live-toggle.sh <deploy[,deploy2,...]> <ENV=VALUE> -- <gate command...>
# Env:   NAMESPACE (default qaroom), ROLLOUT_TIMEOUT (default 120s)
#
# Exit code is the GATE's exit code (the caller decides whether red means caught-as-expected).
# Revert runs on any exit path; a revert failure overrides the exit code with 3 — a leaked
# toggle poisons every later measurement, so it must never fail silently.
set -uo pipefail

NAMESPACE="${NAMESPACE:-qaroom}"
ROLLOUT_TIMEOUT="${ROLLOUT_TIMEOUT:-120s}"

if [[ $# -lt 4 ]]; then
  echo "usage: scripts/live-toggle.sh <deploy[,deploy2]> <ENV=VALUE> -- <gate command...>" >&2
  exit 2
fi

IFS=',' read -ra DEPLOYS <<<"$1"
TOGGLE="$2"
ENV_NAME="${TOGGLE%%=*}"
shift 2
if [[ "$1" != "--" ]]; then
  echo "expected '--' before the gate command" >&2
  exit 2
fi
shift

rollout_all() {
  for d in "${DEPLOYS[@]}"; do
    kubectl rollout status "deploy/${d}" -n "$NAMESPACE" --timeout="$ROLLOUT_TIMEOUT" || return 1
  done
}

revert() {
  echo "▶ reverting ${ENV_NAME} on: ${DEPLOYS[*]}"
  local ok=0
  for d in "${DEPLOYS[@]}"; do
    kubectl set env "deploy/${d}" "${ENV_NAME}-" -n "$NAMESPACE" || ok=1
  done
  rollout_all || ok=1
  if [[ $ok -ne 0 ]]; then
    echo "✗ REVERT FAILED — ${ENV_NAME} may still be armed in ${NAMESPACE}; fix before any further runs" >&2
    return 1
  fi
  echo "✓ reverted; pods rolled back clean"
}

echo "▶ arming ${TOGGLE} on: ${DEPLOYS[*]} (namespace ${NAMESPACE})"
for d in "${DEPLOYS[@]}"; do
  kubectl set env "deploy/${d}" "$TOGGLE" -n "$NAMESPACE"
done
if ! rollout_all; then
  echo "✗ rollout with toggle armed did not settle — reverting" >&2
  revert || exit 3
  exit 2
fi

echo "▶ running gate with ${TOGGLE} live: $*"
"$@"
GATE_EXIT=$?
echo "▶ gate exited ${GATE_EXIT}"

if ! revert; then
  exit 3
fi
exit "$GATE_EXIT"

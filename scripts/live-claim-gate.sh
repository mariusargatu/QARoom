#!/usr/bin/env bash
#
# Live-tier claim gate adapter. `pnpm prove <id> --break` sets the claim's toggle on the GATE
# PROCESS env — which is correct for in-process gates but a no-op for a bug that lives in the
# DEPLOYED pods. This adapter bridges the two worlds: if the named toggle is set in the local
# env, forward it onto the deployment(s) via live-toggle.sh (arm → gate → guaranteed revert);
# otherwise run the gate directly (the clean-evidence path).
#
#   scripts/live-claim-gate.sh <deploy[,deploy2]> <TOGGLE_NAME> -- <gate command...>
set -uo pipefail

DEPLOYS="${1:?usage: live-claim-gate.sh <deployments> <TOGGLE_NAME> -- <gate...>}"
NAME="${2:?usage: live-claim-gate.sh <deployments> <TOGGLE_NAME> -- <gate...>}"
shift 2
if [[ "${1:-}" != "--" ]]; then
  echo "expected '--' before the gate command" >&2
  exit 2
fi
shift

if [[ "${!NAME:-}" == "1" ]]; then
  exec bash scripts/live-toggle.sh "$DEPLOYS" "${NAME}=1" -- "$@"
fi
exec "$@"

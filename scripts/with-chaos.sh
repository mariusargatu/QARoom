#!/usr/bin/env bash
#
# Run a command WHILE a chaos experiment is active, then ALWAYS heal the manifest. The generic
# sibling of scripts/k6-under-chaos.sh (which keeps its own inject/heal because it interleaves
# k6 summary renaming): use this to put ANY technique under failure conditions —
#
#   scripts/with-chaos.sh 02-net-slow-nats -- pnpm tracetest:results <def.yaml>
#
# Exit code is the command's. A manifest that never reaches desiredPhase=Run exits 2.
set -uo pipefail

EXPERIMENT="${1:?usage: with-chaos.sh <experiment-slug> -- <command...>}"
shift
if [[ "${1:-}" != "--" ]]; then
  echo "expected '--' before the command" >&2
  exit 2
fi
shift
MANIFEST="chaos-experiments/${EXPERIMENT}.yaml"

if [[ ! -f "$MANIFEST" ]]; then
  echo "✗ no manifest at ${MANIFEST}" >&2
  exit 2
fi

heal() {
  echo "→ healing ${EXPERIMENT}"
  kubectl delete -f "$MANIFEST" --ignore-not-found >/dev/null 2>&1 || true
}
trap heal EXIT

echo "→ injecting ${EXPERIMENT}"
kubectl apply -f "$MANIFEST"
for _ in $(seq 1 30); do
  phase="$(kubectl get -f "$MANIFEST" -o jsonpath='{.status.experiment.desiredPhase}' 2>/dev/null || true)"
  [[ "$phase" == "Run" ]] && break
  sleep 1
done
if [[ "${phase:-}" != "Run" ]]; then
  echo "✗ ${EXPERIMENT} never reached desiredPhase=Run — is Chaos Mesh installed?" >&2
  exit 2
fi
echo "✓ fault active (desiredPhase=Run)"

"$@"

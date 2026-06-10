#!/usr/bin/env bash
#
# k6 × chaos — the composition the repo documented but never ran (failure-modes.md#02/#04:
# "the full exhaustion demo is load-driven"). Applies one chaos experiment, runs one k6 script
# against the live in-cluster service WHILE the fault is active, captures the summary under a
# chaos-tagged name (so the clean run's artifact survives), and ALWAYS heals the manifest —
# a leaked NetworkChaos poisons every later measurement.
#
#   scripts/k6-under-chaos.sh 02-net-slow-nats vote-cast
#   scripts/k6-under-chaos.sh 04-stress-pg-pool-exhaustion donation
#
# Default K6_SLO_MULTIPLIER=100 = measure-only (observe-class: the payload is the degradation
# DELTA vs the clean run, not a pass/fail). Set it low to turn the run into a gate — that is
# exactly how the CHAOS_SYNC_PUBLISH red demo works (toggle armed -> thresholds must breach).
set -uo pipefail

EXPERIMENT="${1:?usage: k6-under-chaos.sh <experiment-slug> <k6-script>}"
SCRIPT="${2:?usage: k6-under-chaos.sh <experiment-slug> <k6-script>}"
MULTIPLIER="${K6_SLO_MULTIPLIER:-100}"
MANIFEST="chaos-experiments/${EXPERIMENT}.yaml"

if [[ ! -f "$MANIFEST" ]]; then
  echo "✗ no manifest at ${MANIFEST}" >&2
  exit 2
fi

# Each k6 script names its own target service (load-tests/*.js BASE defaults).
case "$SCRIPT" in
  vote-cast | feed) SVC="content" BASE_ENV="CONTENT_BASE_URL" LPORT=18081 ;;
  donation) SVC="donations" BASE_ENV="DONATIONS_BASE_URL" LPORT=18084 ;;
  *)
    echo "✗ unknown k6 script '${SCRIPT}' (vote-cast|feed|donation)" >&2
    exit 2
    ;;
esac

heal() {
  echo "→ healing ${EXPERIMENT}"
  kubectl delete -f "$MANIFEST" --ignore-not-found >/dev/null 2>&1 || true
}
trap heal EXIT

echo "→ injecting ${EXPERIMENT}"
kubectl apply -f "$MANIFEST"
# Wait for the operator to accept the experiment (same jsonpath probe as chaos.sh smoke; the
# resource kind varies per experiment, so probe via the manifest file, not a hardcoded kind).
for _ in $(seq 1 30); do
  phase="$(kubectl get -f "$MANIFEST" -o jsonpath='{.status.experiment.desiredPhase}' 2>/dev/null || true)"
  [[ "$phase" == "Run" ]] && break
  sleep 1
done
if [[ "${phase:-}" != "Run" ]]; then
  echo "✗ ${EXPERIMENT} never reached desiredPhase=Run — is Chaos Mesh installed (pnpm chaos:install)?" >&2
  exit 2
fi
echo "✓ fault active (desiredPhase=Run)"

# Run k6 from its container against a port-forwarded Service. host.docker.internal (not
# --network host): this runs on macOS where host networking does not reach the host loopback.
echo "→ k6 ${SCRIPT}.js under ${EXPERIMENT} (K6_SLO_MULTIPLIER=${MULTIPLIER})"
bash scripts/with-port-forward.sh "${SVC}:${LPORT}:80" -- \
  docker run --rm -v "$PWD":/work -w /work grafana/k6 run "load-tests/${SCRIPT}.js" \
  -e "${BASE_ENV}=http://host.docker.internal:${LPORT}" -e "K6_SLO_MULTIPLIER=${MULTIPLIER}"
K6_EXIT=$?

# Chaos-tag the summary so the clean artifact is never overwritten; k6-results.ts folds it as
# its own script entry ("<script>-<experiment-nn>") in the k6 runner.
TAG="${EXPERIMENT%%-*}"
if [[ -f "test-results/k6-${SCRIPT}.json" ]]; then
  mv "test-results/k6-${SCRIPT}.json" "test-results/k6-${SCRIPT}-chaos${TAG}.json"
  echo "✓ summary: test-results/k6-${SCRIPT}-chaos${TAG}.json (k6 exit ${K6_EXIT})"
fi
exit "$K6_EXIT"

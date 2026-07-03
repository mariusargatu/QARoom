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

# Stash the clean run's summary before k6 overwrites the fixed handleSummary filename.
CLEAN_BACKUP=""
if [[ -f "test-results/k6-${SCRIPT}.json" ]]; then
  CLEAN_BACKUP="test-results/.k6-${SCRIPT}.clean.bak"
  cp "test-results/k6-${SCRIPT}.json" "$CLEAN_BACKUP"
fi

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

# Chaos-tag the summary so it folds as its own entry ("<script>-chaos<NN>") in the k6 runner,
# and RESTORE the clean run's artifact — k6's handleSummary writes a fixed filename, so the
# chaos run just overwrote whatever the clean phase produced (learned the hard way: the first
# gauntlet run lost its clean vote-cast baseline this way).
TAG="${EXPERIMENT%%-*}"
if [[ -f "test-results/k6-${SCRIPT}.json" ]]; then
  # Measure-only runs (multiplier > 1) are OBSERVE-class: a breached SLO under chaos is the expected
  # payload, not a failure. Stamp `observe:true` so k6:results folds the breach as DATA, not a
  # `failed` that pollutes the phase-8 envelope census (an observation that gated would be theater).
  # The ARMED deliberate-bug demo (K6_SLO_MULTIPLIER=1) is left unstamped → its breach still gates
  # red, so `pnpm prove chaos-sync-publish --break` keeps its teeth.
  if [[ "${MULTIPLIER}" != "1" ]]; then
    node -e 'const f=process.argv[1],fs=require("fs");const j=JSON.parse(fs.readFileSync(f,"utf8"));j.observe=true;fs.writeFileSync(f,JSON.stringify(j))' \
      "test-results/k6-${SCRIPT}.json"
  fi
  mv "test-results/k6-${SCRIPT}.json" "test-results/k6-${SCRIPT}-chaos${TAG}.json"
  echo "✓ summary: test-results/k6-${SCRIPT}-chaos${TAG}.json (k6 exit ${K6_EXIT}, observe=$([[ "${MULTIPLIER}" != "1" ]] && echo true || echo false))"
fi
if [[ -f "${CLEAN_BACKUP:-}" ]]; then
  mv "$CLEAN_BACKUP" "test-results/k6-${SCRIPT}.json"
  echo "✓ clean baseline artifact restored"
fi
exit "$K6_EXIT"

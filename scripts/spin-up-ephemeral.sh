#!/usr/bin/env bash
# Namespaced ephemeral environment provisioner (ADR-0001 Commitment 15; consumed by
# the agentic-CI demo (docs/agentic-ci/goals.json) and the per-worktree flow in AGENTS.md). One namespace per
# agent/worktree — `qaroom-<name>` — with the full service set and its OWN NATS, so
# events and consumer state never leak between environments. Postgres is per-service
# via the shared chart, so domain state is namespaced for free.
#
# Mirrors ci.yml's cluster lane (docker build + image load + helm install from
# deploy/<svc>/values.yaml), k3d flavor: `k3d image import` instead of `kind load`.
# The shared observability stack (otel-collector, jaeger, microcks, langfuse) stays
# in the `observability` namespace — read-side, safe to share across environments.
#
#   scripts/spin-up-ephemeral.sh <name>                provision qaroom-<name>
#   scripts/spin-up-ephemeral.sh <name> --skip-build   reuse qaroom/<svc>:ephemeral images
#   scripts/spin-up-ephemeral.sh <name> --down         delete the namespace (all state)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLUSTER=qaroom
TAG=ephemeral

NAME="${1:-}"
if [[ -z "${NAME}" || "${NAME}" == --* ]]; then
  echo "usage: scripts/spin-up-ephemeral.sh <name> [--skip-build|--down]" >&2
  exit 1
fi
if ! [[ "${NAME}" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "✗ name '${NAME}' must be lowercase alphanumeric/dashes (it becomes a k8s namespace)" >&2
  exit 1
fi
NS="qaroom-${NAME}"
shift

SKIP_BUILD=0
DOWN=0
for arg in "$@"; do
  case "${arg}" in
    --skip-build) SKIP_BUILD=1 ;;
    --down) DOWN=1 ;;
    *) echo "✗ unknown flag '${arg}'" >&2; exit 1 ;;
  esac
done

# Preflight: name the missing tool with an install hint instead of a mid-script failure.
for tool in "docker:install Docker Desktop or colima" "k3d:brew install k3d (https://k3d.io)" "kubectl:brew install kubectl" "helm:brew install helm"; do
  command -v "${tool%%:*}" >/dev/null 2>&1 || { echo "✗ missing '${tool%%:*}' — install: ${tool#*:}" >&2; exit 1; }
done

if [[ "${DOWN}" == "1" ]]; then
  kubectl delete namespace "${NS}" --ignore-not-found
  echo "✓ namespace '${NS}' deleted"
  exit 0
fi

# A binary on PATH is not a usable docker; probe the daemon so we refuse fast.
docker info >/dev/null 2>&1 || { echo "✗ docker daemon is not running — start Docker Desktop/colima first" >&2; exit 1; }
k3d cluster list 2>/dev/null | grep -qE "^${CLUSTER}\b" || {
  echo "✗ k3d cluster '${CLUSTER}' not found — run scripts/bootstrap-k3d.sh (or 'pnpm dev') first" >&2
  exit 1
}

# Derive the service set from deploy/<svc>/values.yaml — never enumerate (lists frozen
# at a milestone are how smoke.sh rotted to 3 of 8 services).
SERVICES=()
for values in "${ROOT}"/deploy/*/values.yaml; do
  SERVICES+=("$(basename "$(dirname "${values}")")")
done

IMAGES=()
for svc in "${SERVICES[@]}"; do
  if [[ "${SKIP_BUILD}" == "0" ]]; then
    echo "── building qaroom/${svc}:${TAG}"
    docker build -q -f "${ROOT}/services/${svc}/Dockerfile" -t "qaroom/${svc}:${TAG}" "${ROOT}"
  fi
  IMAGES+=("qaroom/${svc}:${TAG}")
done
# Import even under --skip-build: the kubelet garbage-collects node images under disk
# pressure, so a previous import is no guarantee the image is still on the node — and
# pullPolicy=Never turns that into ErrImageNeverPull. Idempotent, single call (k3d
# round-trips one tarball into every node per invocation).
k3d image import "${IMAGES[@]}" -c "${CLUSTER}"

kubectl create namespace "${NS}" --dry-run=client -o yaml | kubectl apply -f -

# Per-namespace NATS: the manifest hardcodes `namespace: observability`; rewrite so each
# ephemeral environment gets isolated streams + consumer state (the point of Commitment 15).
sed "s/^  namespace: observability$/  namespace: ${NS}/" "${ROOT}/deploy/observability/nats.yaml" | kubectl apply -f -
kubectl -n "${NS}" rollout status deploy/qaroom-nats --timeout=120s

NATS_URL="nats://qaroom-nats.${NS}.svc.cluster.local:4222"
for svc in "${SERVICES[@]}"; do
  EXTRA=()
  # Redirect every NATS consumer/publisher at the namespace-local broker.
  grep -q "NATS_URL" "${ROOT}/deploy/${svc}/values.yaml" && EXTRA+=(--set "extraEnv.NATS_URL=${NATS_URL}")
  # web's values hardcode the main `qaroom` namespace; point it at this one.
  [[ "${svc}" == "web" ]] && EXTRA+=(--set "extraEnv.VITE_API_BASE_URL=http://gateway.${NS}.svc.cluster.local:80")
  helm upgrade --install "${svc}" "${ROOT}/packages/helm-template" -n "${NS}" \
    -f "${ROOT}/deploy/${svc}/values.yaml" \
    --set "image.tag=${TAG}" --set image.pullPolicy=Never \
    "${EXTRA[@]+"${EXTRA[@]}"}"
done

kubectl wait --for=condition=ready pod --all -n "${NS}" --timeout=240s

echo "✓ ephemeral environment '${NS}' ready (${#SERVICES[@]} services, isolated NATS + per-service Postgres)"
echo "  gateway:  kubectl port-forward -n ${NS} svc/gateway 8080:80"
echo "  teardown: scripts/spin-up-ephemeral.sh ${NAME} --down"

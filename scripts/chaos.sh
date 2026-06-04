#!/usr/bin/env bash
# QARoom chaos control (Milestone 6). Opt-in — deliberately NOT part of `pnpm dev`, so the
# inner dev loop pays nothing for chaos operators. Installs Chaos Mesh (and, for experiment 06,
# LitmusChaos) into the running k3d cluster and provides a trivial injection smoke test.
#
#   pnpm chaos:install      # Chaos Mesh into the cluster (helm, pinned)
#   pnpm chaos:install:litmus  # LitmusChaos operator (HTTP chaos for experiment 06)
#   pnpm chaos:smoke        # prove injection works against a throwaway pod
#   pnpm chaos:uninstall    # remove operators (leaves the qaroom/observability stack alone)
#
# The 7 experiments themselves run through the TypeScript steady-state harness
# (`pnpm chaos:run`, tests/chaos/*.test.ts), which applies chaos-experiments/<slug>.yaml,
# asserts the documented behaviour, and tears the experiment down.
set -euo pipefail

# Pinned exact (house rule: latest stable resolved at install, pinned). Bump deliberately.
CHAOS_MESH_VERSION="2.8.2"
CHAOS_NS="chaos-mesh"
LITMUS_NS="litmus"
# k3d/k3s runs containerd at this socket (NOT Docker's). Chaos Mesh's chaos-daemon must be told
# this or pod/network/time fault injection silently no-ops. Overridable for KinD in CI, whose
# socket is /run/containerd/containerd.sock.
K3S_CONTAINERD_SOCKET="${CHAOS_CONTAINERD_SOCKET:-/run/k3s/containerd/containerd.sock}"
TARGET_NS="qaroom"

install_chaos_mesh() {
  helm repo add chaos-mesh https://charts.chaos-mesh.org >/dev/null 2>&1 || true
  helm repo update chaos-mesh >/dev/null
  helm upgrade --install chaos-mesh chaos-mesh/chaos-mesh \
    --namespace "${CHAOS_NS}" --create-namespace \
    --version "${CHAOS_MESH_VERSION}" \
    --set chaosDaemon.runtime=containerd \
    --set chaosDaemon.socketPath="${K3S_CONTAINERD_SOCKET}" \
    --set dashboard.create=false \
    --wait --timeout 5m
  echo "✓ Chaos Mesh ${CHAOS_MESH_VERSION} installed in '${CHAOS_NS}' (containerd socket: ${K3S_CONTAINERD_SOCKET})"
}

install_litmus() {
  # LitmusChaos is the HTTP-fault injector for experiment 06 — Chaos Mesh HTTPChaos is unreliable
  # on k3d's flannel CNI (ADR-0014). Litmus 3.x ships ONLY as the ChaosCenter platform (operator +
  # MongoDB + GraphQL + portal); there is no thin standalone-operator manifest to curl. This step
  # therefore sets up only the deterministic, committed prerequisites — the namespaces and the
  # litmus-admin RBAC the ChaosEngine references — and tells the operator what remains MANUAL.
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  # Namespaces FIRST (a prior version applied the manifest before creating the ns; cluster-scoped
  # objects would apply, exit 0, and the namespaced objects silently never land).
  for ns in "${LITMUS_NS}" "${TARGET_NS}"; do
    kubectl create namespace "${ns}" --dry-run=client -o yaml | kubectl apply -f -
  done
  kubectl apply -f "${ROOT}/chaos-experiments/operators/litmus-rbac.yaml"
  echo "✓ litmus namespaces + litmus-admin RBAC applied."
  echo "→ MANUAL (nightly): install the LitmusChaos ChaosCenter (litmus-helm, pinned) and the"
  echo "  pod-http-status-code ChaosExperiment, then run with CHAOS_LITMUS=1. See ADR-0014 and"
  echo "  docs/failure-modes.md#06 — experiment 06's breaker property is also proven in-process"
  echo "  (services/gateway/tests/circuit-breaker.spec.ts)."
}

# Trivial injection smoke: spin a throwaway pod, kill it with a short PodChaos, confirm the
# experiment reaches an injected phase, then clean up. Asserts the containerd socket override
# + RBAC work WITHOUT perturbing a real service (mirrors scripts/smoke.sh's "assert the real
# mechanism, cheaply" philosophy).
smoke() {
  echo "→ chaos smoke: deploying throwaway target in '${TARGET_NS}'"
  kubectl apply -f - <<'YAML'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: chaos-smoke
  namespace: qaroom
  labels: { app: chaos-smoke }
spec:
  replicas: 1
  selector: { matchLabels: { app: chaos-smoke } }
  template:
    metadata: { labels: { app: chaos-smoke } }
    spec:
      containers:
        - name: pause
          image: registry.k8s.io/pause:3.10
YAML
  kubectl -n "${TARGET_NS}" rollout status deploy/chaos-smoke --timeout=60s

  echo "→ injecting a 10s pod-failure PodChaos"
  kubectl apply -f - <<'YAML'
apiVersion: chaos-mesh.org/v1alpha1
kind: PodChaos
metadata:
  name: chaos-smoke-probe
  namespace: qaroom
spec:
  action: pod-failure
  mode: one
  duration: 10s
  selector:
    namespaces: [qaroom]
    labelSelectors: { app: chaos-smoke }
YAML

  echo "→ waiting for injection"
  for _ in $(seq 1 30); do
    phase="$(kubectl -n "${TARGET_NS}" get podchaos chaos-smoke-probe -o jsonpath='{.status.experiment.desiredPhase}' 2>/dev/null || true)"
    if [ "${phase}" = "Run" ]; then
      echo "✓ PodChaos injected (desiredPhase=Run) — Chaos Mesh can perturb pods"
      break
    fi
    sleep 1
  done

  echo "→ cleaning up smoke resources"
  kubectl -n "${TARGET_NS}" delete podchaos chaos-smoke-probe --ignore-not-found
  kubectl -n "${TARGET_NS}" delete deploy chaos-smoke --ignore-not-found
  [ "${phase:-}" = "Run" ] || { echo "✗ PodChaos never reached Run (last phase: ${phase:-none})"; exit 1; }
}

uninstall() {
  # Delete any lingering chaos CRs first so finalizers don't block namespace teardown.
  kubectl delete podchaos,networkchaos,stresschaos,timechaos --all -n "${TARGET_NS}" --ignore-not-found 2>/dev/null || true
  helm uninstall chaos-mesh -n "${CHAOS_NS}" 2>/dev/null || true
  kubectl delete namespace "${CHAOS_NS}" --ignore-not-found
  kubectl delete namespace "${LITMUS_NS}" --ignore-not-found 2>/dev/null || true
  echo "✓ chaos operators removed (qaroom/observability untouched)"
}

case "${1:-}" in
  install) install_chaos_mesh ;;
  install:litmus) install_litmus ;;
  smoke) smoke ;;
  uninstall) uninstall ;;
  *) echo "usage: chaos.sh {install|install:litmus|smoke|uninstall}" >&2; exit 2 ;;
esac

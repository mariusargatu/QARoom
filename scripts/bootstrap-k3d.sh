#!/usr/bin/env bash
# Idempotent k3d bootstrap for the QARoom local cluster (Milestone 3). Safe to re-run;
# `pnpm dev` calls it before `tilt up`.
set -euo pipefail

CLUSTER=qaroom
REGISTRY=qaroom-registry.localhost
REGISTRY_PORT=5111

# 1. Local image registry (push target the cluster nodes can pull from).
if ! k3d registry list 2>/dev/null | grep -q "k3d-${REGISTRY}"; then
  k3d registry create "${REGISTRY}" --port "${REGISTRY_PORT}"
fi

# 2. Single-node cluster. Traefik disabled (no Ingress in M3 — Tilt port-forwards instead).
if ! k3d cluster list 2>/dev/null | grep -qE "^${CLUSTER}\b"; then
  k3d cluster create "${CLUSTER}" \
    --registry-use "k3d-${REGISTRY}:${REGISTRY_PORT}" \
    --api-port 6550 \
    --servers 1 --agents 0 \
    --k3s-arg "--disable=traefik@server:0" \
    --wait
  # M6: chaos-readiness (TimeChaos needs SYS_TIME/SYS_BOOT) will add
  #   --k3s-arg "--kubelet-arg=allowed-unsafe-sysctls=*@server:0"
fi

# 3. Namespaces (idempotent).
for ns in qaroom observability; do
  kubectl create namespace "${ns}" --dry-run=client -o yaml | kubectl apply -f -
done

echo "✓ k3d cluster '${CLUSTER}' ready — registry push prefix: k3d-${REGISTRY}:${REGISTRY_PORT}"
echo "  context: $(kubectl config current-context)"

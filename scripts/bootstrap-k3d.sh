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

# 2. Single-node cluster. Traefik (k3s's built-in Ingress controller) is ENABLED and host ports
# 80/443 are mapped to the serverlb, so the whole platform is reachable at http://*.localhost with
# no port-forward (Ingress rules in deploy/ingress.yaml; *.localhost loops back to 127.0.0.1 in
# every browser per RFC 6761). Tilt still declares port-forwards as a fallback.
# The unsafe-sysctls kubelet arg is M6 chaos-readiness: Chaos Mesh TimeChaos needs SYS_TIME/
# SYS_BOOT on its target pods, which the kubelet rejects unless the sysctls are allow-listed
# at cluster-create time (it cannot be toggled later — recreate the cluster to change it).
# Always on: it only *permits* the sysctls; nothing uses them until a TimeChaos pod requests
# them, so a chaos-free dev loop pays nothing for it. (Must list the namespaced sysctl PATTERNS
# explicitly — a bare `*` is rejected by the k3s v1.33 kubelet and wedges cluster create.)
# The ports and Traefik are likewise
# create-time only — change here, then recreate (`pnpm dev:down && pnpm dev`) to take effect.
if ! k3d cluster list 2>/dev/null | grep -qE "^${CLUSTER}\b"; then
  k3d cluster create "${CLUSTER}" \
    --registry-use "k3d-${REGISTRY}:${REGISTRY_PORT}" \
    --api-port 6550 \
    -p "80:80@loadbalancer" \
    -p "443:443@loadbalancer" \
    --servers 1 --agents 0 \
    --k3s-arg "--kubelet-arg=allowed-unsafe-sysctls=kernel.shm*,kernel.msg*,kernel.sem,fs.mqueue.*,net.*@server:0" \
    --wait
fi

# 3. Namespaces (idempotent).
for ns in qaroom observability; do
  kubectl create namespace "${ns}" --dry-run=client -o yaml | kubectl apply -f -
done

echo "✓ k3d cluster '${CLUSTER}' ready — registry push prefix: k3d-${REGISTRY}:${REGISTRY_PORT}"
echo "  context: $(kubectl config current-context)"
echo "  exposed (after 'pnpm dev', no port-forward):"
echo "    app:        http://qaroom.localhost        (web UI; calls /api + /ws on the gateway)"
echo "    moderator:  http://moderator.localhost"
echo "    grafana:    http://grafana.localhost     jaeger: http://jaeger.localhost"
echo "    prometheus: http://prometheus.localhost  tracetest: http://tracetest.localhost"
echo "    microcks:   http://microcks.localhost"

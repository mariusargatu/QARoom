#!/usr/bin/env bash
# Post-`tilt up` smoke (Milestone 3 exit criterion): assert /health returns 200 on EVERY
# service THROUGH its k8s Service (so a wrong `service.targetPort` is caught). `kubectl
# port-forward svc/<name>` routes via the Service's targetPort, so the deliberate-broken
# value (deploy/content/values.broken.yaml → targetPort 9999) makes this fail.
set -euo pipefail

NS="${NS:-qaroom}"
OBS_NS="${OBS_NS:-observability}"
SERVICES="gateway:18080 content:18081 identity:18082"
NATS_PORT=18222
pids=""
fail=0

cleanup() {
  for p in $pids; do kill "$p" 2>/dev/null || true; done
}
trap cleanup EXIT

for entry in $SERVICES; do
  name="${entry%%:*}"
  lport="${entry##*:}"
  kubectl -n "$NS" port-forward "svc/${name}" "${lport}:80" >/dev/null 2>&1 &
  pids="$pids $!"
done

# NATS lives in the observability namespace; monitoring/HTTP port 8222 serves /healthz.
kubectl -n "$OBS_NS" port-forward "svc/qaroom-nats" "${NATS_PORT}:8222" >/dev/null 2>&1 &
pids="$pids $!"

# curl --retry-connrefused waits out the port-forward warmup without a shell sleep.
for entry in $SERVICES; do
  name="${entry%%:*}"
  lport="${entry##*:}"
  if curl --retry 30 --retry-delay 1 --retry-connrefused -fsS "http://localhost:${lport}/health" >/dev/null 2>&1; then
    echo "✓ ${name} /health 200 (via Service)"
  else
    echo "✗ ${name} /health FAILED (via Service, local :${lport})"
    fail=1
  fi
done

# NATS health: JetStream broker is up if its monitoring /healthz returns 200.
if curl --retry 30 --retry-delay 1 --retry-connrefused -fsS "http://localhost:${NATS_PORT}/healthz" >/dev/null 2>&1; then
  echo "✓ qaroom-nats /healthz 200 (via Service)"
else
  echo "✗ qaroom-nats /healthz FAILED (via Service, local :${NATS_PORT})"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "smoke: all services healthy"
else
  echo "smoke: FAILED"
  exit 1
fi

# Beyond /health: the rollout all-transitions tour through the Ingress exercises the full
# request path (Traefik -> gateway proxy -> flags-service -> Postgres) edge by edge.
bash "$(dirname "$0")/live-rollout-tour.sh"

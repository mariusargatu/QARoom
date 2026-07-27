#!/usr/bin/env bash
# Post-`tilt up` smoke (Milestone 3 exit criterion): assert the liveness probe returns 200 on
# EVERY service THROUGH its k8s Service (so a wrong `service.targetPort` is caught). `kubectl
# port-forward svc/<name>` routes via the Service's targetPort, so the deliberate-broken value
# (deploy/content/values.broken.yaml → targetPort 9999) makes this fail.
#
# The service list is DERIVED from deploy/*/values.yaml (every chart values file except
# observability, which ships raw manifests, not a values.yaml) — it never freezes at a subset.
# The probe path is derived too: it is each service's `probes.liveness.path` override, defaulting
# to the shared chart default (/health). Web is a static Vite SPA with no /health: it overrides the
# probe to "/" (vite preview serves index.html there), and is probed at "/" accordingly.
set -euo pipefail

# Preflight: name the missing tool with an install hint instead of a mid-script command-not-found.
for tool in "kubectl:brew install kubectl" "curl:brew install curl (usually preinstalled)"; do
  command -v "${tool%%:*}" >/dev/null 2>&1 || { echo "✗ missing '${tool%%:*}' — install: ${tool#*:}" >&2; exit 1; }
done

NS="${NS:-qaroom}"
OBS_NS="${OBS_NS:-observability}"
DEPLOY_DIR="$(dirname "$0")/../deploy"
BASE_PORT=18080
NATS_PORT=18222
MICROCKS_PORT=18223
pids=""
fail=0

cleanup() {
  for p in $pids; do kill "$p" 2>/dev/null || true; done
}
trap cleanup EXIT

# Derive each service's liveness probe path from its chart values override, falling back to the
# shared chart default (/health). awk waits for the `liveness:` key, then prints the first `path:`
# value beneath it (readiness, which follows, is never reached). No probes block → empty → /health.
probe_path() {
  local vf="$1" p
  p="$(awk '/liveness:/{f=1} f&&/path:/{print $2; exit}' "$vf")"
  printf '%s' "${p:-/health}"
}

# Build the "<name>:<lport>:<probe>" service list from the chart values files. The glob over
# deploy/*/values.yaml is sorted (C locale), so each service gets a stable, distinct local
# port-forward port: BASE_PORT + its index.
SERVICES=""
i=0
for vf in "$DEPLOY_DIR"/*/values.yaml; do
  name="$(basename "$(dirname "$vf")")"
  lport=$((BASE_PORT + i))
  SERVICES="$SERVICES ${name}:${lport}:$(probe_path "$vf")"
  i=$((i + 1))
done

for entry in $SERVICES; do
  name="${entry%%:*}"
  rest="${entry#*:}"
  lport="${rest%%:*}"
  kubectl -n "$NS" port-forward "svc/${name}" "${lport}:80" >/dev/null 2>&1 &
  pids="$pids $!"
done

# NATS lives in the observability namespace; monitoring/HTTP port 8222 serves /healthz.
kubectl -n "$OBS_NS" port-forward "svc/qaroom-nats" "${NATS_PORT}:8222" >/dev/null 2>&1 &
# Microcks serves the payment-provider mock donations settles through.
kubectl -n "$OBS_NS" port-forward "svc/qaroom-microcks" "${MICROCKS_PORT}:8080" >/dev/null 2>&1 &
pids="$pids $!"

# curl --retry-connrefused waits out the port-forward warmup without a shell sleep.
for entry in $SERVICES; do
  name="${entry%%:*}"
  rest="${entry#*:}"
  lport="${rest%%:*}"
  probe="${rest##*:}"
  if curl --retry 30 --retry-delay 1 --retry-connrefused -fsS "http://localhost:${lport}${probe}" >/dev/null 2>&1; then
    echo "✓ ${name} ${probe} 200 (via Service)"
  else
    echo "✗ ${name} ${probe} FAILED (via Service, local :${lport})"
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

# The Microcks payment mock. Until now the ONLY evidence this worked was a prose comment in
# deploy/donations/values.yaml: nothing in any lane ever asked the mock for a charge, so the
# 404-every-charge bug (donations 502) could regress silently and did, for weeks. Probing the exact
# URL donations is configured with means a title rename, a failed import Job, or re-encoded parens
# all fail HERE rather than as a mystery 502 in a load test.
MOCK_PATH=$(
  sed -n 's|.*PAYMENT_PROVIDER_BASE_URL: *"[^"]*:8080\(/rest/[^"]*\)".*|\1|p' \
    "$(dirname "$0")/../deploy/donations/values.yaml"
)
if [ -z "$MOCK_PATH" ]; then
  echo "✗ microcks: could not read the mock path out of deploy/donations/values.yaml"
  fail=1
else
  # --path-as-is: the literal parens in the path must reach Microcks unmodified; re-encoding them
  # to %28/%29 is the measured 404 cause.
  code=$(curl --retry 30 --retry-delay 1 --retry-connrefused -s --path-as-is -o /tmp/qaroom-charge.json \
    -w '%{http_code}' -X POST "http://localhost:${MICROCKS_PORT}${MOCK_PATH}/charges" \
    -H 'content-type: application/json' -H 'idempotency-key: smoke-1' \
    -d '{"amount_cents":2500,"currency":"USD"}' || echo 000)
  if [ "$code" = "200" ] && grep -q '"status" *: *"captured"' /tmp/qaroom-charge.json; then
    echo "✓ microcks POST ${MOCK_PATH}/charges 200 captured"
  else
    echo "✗ microcks POST ${MOCK_PATH}/charges returned ${code} (expected 200 captured)"
    echo "  body: $(head -c 200 /tmp/qaroom-charge.json 2>/dev/null)"
    echo "  check: the import Job completed, and info.title/info.version still match this path"
    fail=1
  fi
fi

if [ "$fail" -eq 0 ]; then
  echo "smoke: all services healthy"
else
  echo "smoke: FAILED"
  exit 1
fi

# Beyond the probe: the rollout all-transitions tour through the Ingress exercises the full
# request path (Traefik -> gateway proxy -> flags-service -> Postgres) edge by edge.
bash "$(dirname "$0")/live-rollout-tour.sh"

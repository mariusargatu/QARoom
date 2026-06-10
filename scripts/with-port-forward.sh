#!/usr/bin/env bash
#
# Run a command with one or more kubectl port-forwards up, then ALWAYS tear them down.
# Forward spec: [namespace/]service:localPort:remotePort, comma-separated.
#
#   scripts/with-port-forward.sh content:18081:80 -- bash scripts/x.sh
#   scripts/with-port-forward.sh observability/qaroom-tracetest:11633:11633,gateway:18090:80 -- cmd
#
# Default namespace: qaroom (override per-spec with the ns/ prefix). Exit code is the command's.
set -uo pipefail

if [[ $# -lt 3 ]]; then
  echo "usage: scripts/with-port-forward.sh <[ns/]svc:lport:rport[,...]> -- <command...>" >&2
  exit 2
fi

SPECS="$1"
shift
if [[ "$1" != "--" ]]; then
  echo "expected '--' before the command" >&2
  exit 2
fi
shift

PIDS=()
cleanup() {
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

IFS=',' read -ra FORWARDS <<<"$SPECS"
for spec in "${FORWARDS[@]}"; do
  ns="qaroom"
  rest="$spec"
  if [[ "$spec" == */* ]]; then
    ns="${spec%%/*}"
    rest="${spec#*/}"
  fi
  IFS=':' read -r svc lport rport <<<"$rest"
  kubectl -n "$ns" port-forward "svc/${svc}" "${lport}:${rport}" >/dev/null 2>&1 &
  PIDS+=($!)
done

# Wait for every local port to accept connections (the forwards warm up asynchronously).
for spec in "${FORWARDS[@]}"; do
  rest="${spec#*/}"
  IFS=':' read -r _svc lport _rport <<<"$rest"
  for _ in $(seq 1 30); do
    nc -z localhost "$lport" >/dev/null 2>&1 && break
    sleep 1
  done
  if ! nc -z localhost "$lport" >/dev/null 2>&1; then
    echo "✗ port-forward to :${lport} never became ready (${spec})" >&2
    exit 2
  fi
done

"$@"

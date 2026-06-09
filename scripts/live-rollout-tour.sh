#!/usr/bin/env bash
# Live all-transitions tour of the rollout machine through the running cluster:
# real HTTP -> Traefik Ingress -> gateway proxy -> flags-service -> real Postgres.
# The same checking sequence the in-proc mbt suite proves (docs/spikes/07), at the highest
# fidelity tier available: a 409 probe plus a 10-step transition tour covering all 7 edges
# with a per-step echoed-state check (status-message oracle — detects output AND transfer
# faults). Uses a fresh flag key per run because real Postgres persists state across runs.
set -euo pipefail

BASE_URL="${BASE_URL:-http://qaroom.localhost}"
COMMUNITY="comm_01HZY0K7M3QF8VN2J5RX9TB4CD"
FLAG="live-tour-$$"
URL="${BASE_URL}/api/communities/${COMMUNITY}/flags/${FLAG}/rollout"

# The counter is incremented OUTSIDE fire(): `$(fire ...)` runs in a subshell, so an
# increment inside would be lost and every call would reuse the first idempotency key
# (which the gateway rightly rejects with idempotency-key-conflict).
n=0
fire() { # $1 = event, $2 = key suffix; echoes "<body>\n<http_code>"
  curl -s -m 10 --retry 5 --retry-delay 1 --retry-connrefused \
    -H "content-type: application/json" \
    -H "idempotency-key: live-tour-$$-$2" \
    -d "{\"event\":\"$1\"}" -w '\n%{http_code}' "$URL"
}

state_of() { echo "$1" | sed -n 's/.*"state":"\([A-Za-z]*\)".*/\1/p'; }

# Negative probe: illegal from the fresh flag's Off state must 409 with the named problem.
n=$((n + 1))
out="$(fire CanaryConfirmed "$n")"
code="${out##*$'\n'}"
body="${out%$'\n'*}"
if [ "$code" != "409" ] || ! echo "$body" | grep -q "rollout-transition-illegal"; then
  echo "✗ illegal probe: expected 409 rollout-transition-illegal, got ${code}: ${body}"
  exit 1
fi
echo "✓ 409 probe — CanaryConfirmed from Off rejected"

# Transition tour: covers all 7 edges (incl. the 3 back-edges no shortest/simple path crosses).
TOUR="EnableRequested:Enabling RolloutAborted:Off EnableRequested:Enabling \
CanaryConfirmed:Canary RolloutAborted:Off EnableRequested:Enabling CanaryConfirmed:Canary \
RolloutCompleted:Enabled DisableRequested:Disabling DisableCompleted:Off"

from="Off"
covered=""
for step in $TOUR; do
  event="${step%%:*}"
  expected="${step##*:}"
  n=$((n + 1))
  out="$(fire "$event" "$n")"
  code="${out##*$'\n'}"
  body="${out%$'\n'*}"
  echoed="$(state_of "$body")"
  if [ "$code" != "200" ] || [ "$echoed" != "$expected" ]; then
    echo "✗ ${from} --${event}--> expected ${expected}, got code=${code} state=${echoed}"
    echo "  ${body}"
    exit 1
  fi
  echo "✓ ${from} --${event}--> ${echoed}"
  covered="${covered}${from}|${event}|${echoed}"$'\n'
  from="$echoed"
done

ALL_EDGES="Off|EnableRequested|Enabling Enabling|CanaryConfirmed|Canary \
Enabling|RolloutAborted|Off Canary|RolloutCompleted|Enabled Canary|RolloutAborted|Off \
Enabled|DisableRequested|Disabling Disabling|DisableCompleted|Off"

hit=0
total=0
for e in $ALL_EDGES; do
  total=$((total + 1))
  if echo "$covered" | grep -qF "$e"; then hit=$((hit + 1)); else echo "✗ edge never crossed: $e"; fi
done

echo "live tour: edge_coverage ${hit}/${total}"
[ "$hit" -eq "$total" ]

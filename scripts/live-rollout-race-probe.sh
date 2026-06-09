#!/usr/bin/env bash
# Single-writer-per-resource probe against the RUNNING cluster (the commitment: mutations
# serialized by Postgres advisory locks + SELECT ... FOR UPDATE). This claim is structurally
# untestable in the in-proc harness — PGlite is single-connection, so lock contention never
# happens there. Here N concurrent identical transitions race across real connections through
# the full path (Ingress -> gateway -> flags-service -> Postgres); the linearizable outcome is
# EXACTLY ONE 200 (the winner moves Off -> Enabling) and N-1 conflict 409s (after the winner,
# EnableRequested is illegal from Enabling), with the final state a legal machine state.
# Weak-oracle version of a qsm-style parallel property: no interleaving search, one invariant.
set -euo pipefail

BASE_URL="${BASE_URL:-http://qaroom.localhost}"
COMMUNITY="comm_01HZY0K7M3QF8VN2J5RX9TB4CD"
FLAG="race-probe-$$"
URL="${BASE_URL}/api/communities/${COMMUNITY}/flags/${FLAG}/rollout"
N="${N:-10}"

outdir="$(mktemp -d)"
trap 'rm -rf "$outdir"' EXIT

# Fire N racers truly concurrently, each with its OWN idempotency key (distinct keys make
# the dedup layer irrelevant; only the advisory lock can serialize them).
i=1
while [ "$i" -le "$N" ]; do
  curl -s -m 15 -o "${outdir}/body.${i}" -w '%{http_code}' \
    -H "content-type: application/json" \
    -H "idempotency-key: race-probe-$$-${i}" \
    -d '{"event":"EnableRequested"}' "$URL" > "${outdir}/code.${i}" &
  i=$((i + 1))
done
wait

ok=0
conflict=0
other=0
i=1
while [ "$i" -le "$N" ]; do
  code="$(cat "${outdir}/code.${i}")"
  case "$code" in
    200) ok=$((ok + 1)) ;;
    409)
      if grep -q "rollout-transition-illegal" "${outdir}/body.${i}"; then
        conflict=$((conflict + 1))
      else
        echo "✗ racer ${i}: unexpected 409 problem: $(cat "${outdir}/body.${i}")"
        other=$((other + 1))
      fi
      ;;
    *)
      echo "✗ racer ${i}: unexpected status ${code}: $(cat "${outdir}/body.${i}")"
      other=$((other + 1))
      ;;
  esac
  i=$((i + 1))
done

final="$(curl -s -m 10 "${BASE_URL}/api/communities/${COMMUNITY}/flags/${FLAG}" |
  sed -n 's/.*"state":"\([A-Za-z]*\)".*/\1/p')"

echo "race probe: ${N} concurrent EnableRequested -> ${ok}x200 ${conflict}x409 ${other}x other, final state ${final}"

if [ "$ok" -eq 1 ] && [ "$conflict" -eq $((N - 1)) ] && [ "$other" -eq 0 ] && [ "$final" = "Enabling" ]; then
  echo "✓ single-writer holds: exactly one winner, ${conflict} clean conflicts, legal final state"
else
  echo "✗ single-writer VIOLATED (expected 1x200, $((N - 1))x409, final Enabling)"
  exit 1
fi

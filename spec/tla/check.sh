#!/usr/bin/env bash
# Run TLC over every committed TLA+ spec (WebhookDelivery, Rollout, Dedup, Outbox) and fail if any
# spec is not model-checking-green. This is the reproduction harness for the by-hand TLA+ proof
# (spec/tla/README.md) and the script a dispatched CI lane would call (Tier-B; see README "How to
# run"). It is intentionally NOT on the blocking PR path — the runtime-assertion bindings are.
#
#   ./check.sh                 # check all specs
#   ./check.sh Rollout         # check one spec
#   TLA_TOOLS_JAR=/path.jar ./check.sh
#
# Needs Java (17+). If TLA_TOOLS_JAR is unset and ./tla2tools.jar is absent, it downloads the pinned
# release once (gitignored). Exit code is non-zero on the first spec TLC reports an error for.
set -euo pipefail

cd "$(dirname "$0")"

TLA_VERSION="v1.8.0"
JAR="${TLA_TOOLS_JAR:-./tla2tools.jar}"

if [ ! -f "$JAR" ]; then
  echo "tla2tools.jar not found — downloading $TLA_VERSION ..."
  curl -fsSL -o "$JAR" \
    "https://github.com/tlaplus/tlaplus/releases/download/${TLA_VERSION}/tla2tools.jar"
fi

if ! command -v java >/dev/null 2>&1; then
  echo "java not found on PATH — install a JDK (17+) or set up jenv to run TLC." >&2
  exit 127
fi

SPECS=("$@")
if [ "${#SPECS[@]}" -eq 0 ]; then
  SPECS=(WebhookDelivery Rollout Dedup Outbox)
fi

fail=0
for spec in "${SPECS[@]}"; do
  echo "================== TLC: ${spec} =================="
  if java -cp "$JAR" tlc2.TLC -config "${spec}.cfg" "${spec}.tla" | tee "/tmp/tlc-${spec}.out" \
      | grep -E "Model checking completed|Error|violated|is violated"; then
    if grep -qE "Error|violated" "/tmp/tlc-${spec}.out"; then
      echo "FAILED: ${spec}"
      fail=1
    fi
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "One or more specs are not TLC-green." >&2
  exit 1
fi
echo "All specs TLC-green."

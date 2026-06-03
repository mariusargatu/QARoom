#!/usr/bin/env bash
# Tear down the QARoom local cluster + registry (Milestone 3). `pnpm dev:down` calls this
# after `tilt down`. Guarded so a missing cluster/registry is not an error.
set -euo pipefail

k3d cluster delete qaroom || true
k3d registry delete k3d-qaroom-registry.localhost || true
echo "✓ k3d cluster + registry removed"

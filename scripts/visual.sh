#!/usr/bin/env bash
# Vitest visual-regression in the pinned container (ADR-0027 §3) so screenshots render identically on
# a laptop and in CI. Builds services/web/Dockerfile.visual, then:
#   scripts/visual.sh            # CHECK: run the visual gate against the committed baseline
#   scripts/visual.sh --update   # UPDATE: regenerate baselines, extract them back to the host
# Needs a running Docker daemon. The baseline PNGs (`*-chromium-linux.png`) are committed; everything
# else under __screenshots__ is gitignored.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE=qaroom/visual

docker build -f "$ROOT/services/web/Dockerfile.visual" -t "$IMAGE" "$ROOT"

if [ "${1:-}" = "--update" ]; then
  # Regenerate in the pinned env, then stream the __screenshots__ dirs back to the host as a tar.
  # pnpm logs go to stderr so they never corrupt the tar on stdout; the inner `|| true` keeps the
  # baseline-creation "failure" (vitest exits non-zero when it WRITES a new baseline) from aborting
  # extraction — but if NO __screenshots__ were produced the inner script exits 3, and `pipefail`
  # (set -o above) propagates any stage failure so we error loudly instead of falsely reporting success.
  if docker run --rm "$IMAGE" bash -lc '
        pnpm --filter @qaroom/web run test:component -- --update >&2 || true
        DIRS=$(cd /repo && find services/web -type d -name __screenshots__)
        [ -n "$DIRS" ] || { echo "no __screenshots__ produced — nothing to extract" >&2; exit 3; }
        tar -C /repo -cf - $DIRS
      ' | tar -C "$ROOT" -xvf -; then
    echo "baselines updated under services/web/**/__screenshots__ — review and commit the *-chromium-linux.png"
  else
    echo "visual:update FAILED — no baselines were extracted (see container logs above)" >&2
    exit 1
  fi
else
  # CMD is the gate; a non-zero exit (pixel diff) propagates out.
  docker run --rm "$IMAGE"
fi

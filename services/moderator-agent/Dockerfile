# moderator-agent (Milestone 9) — the one Python service. Build context is the repo root, like the
# Node services, but this image is self-contained (no pnpm workspace): uv installs from the committed
# lockfile for a reproducible build. The OTel GenAI semconv opt-in matches every other service (ADR-0009).
# 3.13, matching .python-version and pyproject's `requires-python = ">=3.13,<3.14"`. On 3.14 the base
# interpreter can NEVER satisfy that constraint, so uv silently downloaded its own CPython 3.13 into
# /root/.local/share/uv — a mode-700 directory. The venv's python symlink then pointed inside /root,
# and under the chart's non-root UID the container died with
# `failed to canonicalize /app/.venv/bin/python3: Permission denied` before any code ran.
FROM python:3.14-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app
# Defence in depth for the above: if the pinned version ever diverges from the base image again,
# uv's managed interpreter lands somewhere world-readable instead of inside /root.
ENV UV_PYTHON_INSTALL_DIR=/opt/uv/python \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental \
    PORT=8086

# Dependency layer (cached): resolve from the lockfile before the source is copied.
COPY services/moderator-agent/pyproject.toml services/moderator-agent/uv.lock services/moderator-agent/.python-version ./
RUN uv sync --frozen --no-install-project --no-dev

# Source + the rules seeded into the moderator's own Postgres on boot.
COPY services/moderator-agent/src ./src
COPY services/moderator-agent/rules ./rules
# The SME golden set — seeded into Langfuse as a dataset on boot (langfuse_seed). Just the data, not
# the heavy eval stack under evals/.
COPY services/moderator-agent/evals/golden ./evals/golden
RUN uv sync --frozen --no-dev

EXPOSE 8086
# `--no-sync`: the venv is built at IMAGE BUILD time and is root-owned. Without this, `uv run`
# re-resolves the project on every start and tries to rewrite /app/.venv, which the chart's non-root
# UID cannot do — `failed to remove ..._editable_impl_...pth: Permission denied`. A container should
# not be mutating its own dependencies at boot anyway.
CMD ["uv", "run", "--no-dev", "--no-sync", "python", "-m", "moderator_agent.server"]

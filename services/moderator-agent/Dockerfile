# moderator-agent (Milestone 9) — the one Python service. Build context is the repo root, like the
# Node services, but this image is self-contained (no pnpm workspace): uv installs from the committed
# lockfile for a reproducible build. The OTel GenAI semconv opt-in matches every other service (ADR-0009).
FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
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
CMD ["uv", "run", "--no-dev", "python", "-m", "moderator_agent.server"]

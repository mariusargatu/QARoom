# content-service image. Build context is the REPO ROOT (monorepo):
#   docker build -f services/content/Dockerfile -t qaroom/content .
# Milestone 0 runs via tsx; bundling/compilation lands when deployment shape matters (Milestone 3).
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

# Install workspace dependencies (cached on lockfile changes).
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages ./packages
COPY services/content ./services/content
COPY tools ./tools
RUN pnpm install --frozen-lockfile

EXPOSE 8081
ENV PORT=8081
ENV OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental
# OTel SDK preload (Milestone 3) must run before server.ts so instrumentation patches http/fastify.
CMD ["pnpm", "--filter", "@qaroom/content", "exec", "tsx", "--import", "./src/telemetry.ts", "src/server.ts"]

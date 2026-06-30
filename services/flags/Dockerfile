# flags-service image. Build context is the REPO ROOT (monorepo):
#   docker build -f services/flags/Dockerfile -t qaroom/flags .
FROM node:26-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

# Install workspace dependencies (cached on lockfile changes).
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages ./packages
COPY services/flags ./services/flags
COPY tools ./tools
RUN pnpm install --frozen-lockfile

EXPOSE 8083
ENV PORT=8083
ENV OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental
# OTel SDK preload must run before server.ts so instrumentation patches http/fastify.
CMD ["pnpm", "--filter", "@qaroom/flags", "exec", "tsx", "--import", "./src/telemetry.ts", "src/server.ts"]

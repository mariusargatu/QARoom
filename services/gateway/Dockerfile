# gateway image. Build context is the REPO ROOT (monorepo):
#   docker build -f services/gateway/Dockerfile -t qaroom/gateway .
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages ./packages
COPY services/gateway ./services/gateway
COPY tools ./tools
RUN pnpm install --frozen-lockfile

EXPOSE 8080
ENV PORT=8080
ENV CONTENT_BASE_URL=http://content:8081
ENV OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental
# OTel SDK preload (Milestone 3) must run before server.ts so instrumentation patches http/fastify.
CMD ["pnpm", "--filter", "@qaroom/gateway", "exec", "tsx", "--import", "./src/telemetry.ts", "src/server.ts"]

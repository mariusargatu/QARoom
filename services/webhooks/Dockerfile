# webhooks-service image. Build context is the REPO ROOT (monorepo):
#   docker build -f services/webhooks/Dockerfile -t qaroom/webhooks .
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages ./packages
COPY services/webhooks ./services/webhooks
COPY tools ./tools
RUN pnpm install --frozen-lockfile=false

EXPOSE 8087
ENV PORT=8087
ENV OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental
CMD ["pnpm", "--filter", "@qaroom/webhooks", "exec", "tsx", "--import", "./src/telemetry.ts", "src/server.ts"]

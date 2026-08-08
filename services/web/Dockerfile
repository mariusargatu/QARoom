# web frontend image. Build context is the REPO ROOT (monorepo):
#   docker build -f services/web/Dockerfile -t qaroom/web .
# Builds the Vite bundle and serves it with `vite preview`. VITE_API_BASE_URL is a BUILD arg
# (Vite inlines VITE_* at build time, not runtime).
FROM node:26-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g corepack@latest && corepack enable
WORKDIR /repo

# tsconfig.base.json is required: services/web/tsconfig.json extends it, so the `tsc` build step
# below fails without it (it lives at the repo root, outside services/web).
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.base.json ./
COPY packages ./packages
COPY services/web ./services/web
COPY tools ./tools
RUN pnpm install --frozen-lockfile

ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN pnpm --filter @qaroom/web build

EXPOSE 8085
# `--configLoader native` is LOAD BEARING under the chart's non-root UID. The default ("bundle")
# compiles vite.config.ts to `node_modules/.vite-temp/vite.config.ts.timestamp-*.mjs` before reading
# it; /repo is built as root, so UID 10001 cannot write there and preview dies with
# `EACCES: open '/repo/services/web/node_modules/.vite-temp/...'` — the pod CrashLoopBackOffs before
# serving a byte. "native" loads the TS config through Node's own type stripping instead, writing
# nothing. (The proper long-term fix is not to serve a built SPA with a dev-server command at all;
# this keeps the image honest until that lands.)
CMD ["pnpm", "--filter", "@qaroom/web", "exec", "vite", "preview", "--host", "0.0.0.0", "--port", "8085", "--configLoader", "native"]

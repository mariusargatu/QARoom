import { createProductionDeps, runServer } from '@qaroom/service-kit'
import { httpServiceClient, type ServiceBaseUrls } from './client/http-service-client'
import { McpCore } from './server/core'
import { fileSummaryProvider } from './server/summary-provider'
import { createMcpHttpApp } from './transport/http'

/**
 * Production bootstrap. The MCP server fronts the live services over HTTP and reuses the
 * production determinism trio (Clock/IdGenerator) — the same runtime discipline as every
 * other QARoom service (ADR-0006).
 */
function readPort(): number {
  const raw = process.env.MCP_PORT
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isInteger(parsed) ? parsed : 8090
}

// Defaults target the local Traefik ingress (`pnpm dev`). A cluster deployment MUST set
// GATEWAY_URL / CONTENT_URL to the in-cluster service DNS (e.g. http://gateway:80) — the
// localhost defaults will not resolve in-pod.
const baseUrls: ServiceBaseUrls = {
  gateway: process.env.GATEWAY_URL ?? 'http://qaroom.localhost',
  content: process.env.CONTENT_URL ?? 'http://content.qaroom.localhost',
}

const { clock, ids } = createProductionDeps()
const core = new McpCore({
  deps: { clock, ids },
  services: httpServiceClient(baseUrls),
  summary: fileSummaryProvider(),
})

runServer(() => createMcpHttpApp(core), { port: readPort(), name: 'qaroom-mcp' })

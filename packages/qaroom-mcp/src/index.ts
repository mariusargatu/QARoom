export {
  type FixtureRoute,
  fixtureServiceClient,
  jsonResponse,
  problemResponse,
} from './client/fixture-service-client'
export { httpServiceClient, type ServiceBaseUrls } from './client/http-service-client'
export {
  type ConventionsInput,
  type ConventionsOracle,
  createConventionsOracle,
} from './conventions/oracle'
export type { McpDeps, ServiceClient, ServiceResponse } from './deps'
export {
  buildManifest,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  stringifyManifest,
} from './manifest/build-manifest'
export {
  breakingManifestChanges,
  classifyManifestChanges,
  type ManifestChange,
  type ManifestChangeKind,
} from './manifest/diff'
export { buildResourceEntries, type ResourceEntry } from './registry/resources'
export { buildToolEntries, CONVENTIONS_TOOL_NAME, type ToolEntry } from './registry/tools'
export {
  ConventionsVerdict,
  McpManifest,
  McpResourceDef,
  McpResourceOutcome,
  McpToolDef,
  McpToolOutcome,
} from './schema/mcp'
export { McpCore, type McpCoreOptions } from './server/core'
export {
  DEFAULT_SUMMARY_PATH,
  fileSummaryProvider,
  type SummaryProvider,
  staticSummaryProvider,
} from './server/summary-provider'
export type { McpClient } from './transport/client'
export { createMcpHttpApp, httpMcpClient, type RpcPost } from './transport/http'
export { inMemoryClient } from './transport/in-memory'

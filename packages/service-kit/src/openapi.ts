import {
  buildOpenApiDocument,
  type OasInfo,
  type OasOperation,
  type OasServer,
  stringifyOpenApi,
} from '@qaroom/contracts'

/**
 * A service's OpenAPI YAML: its Zod-registered schemas plus the operations it
 * owns, serialized deterministically. The build script and the byte-identical
 * round-trip test both reach it through the per-service `*-openapi-document.ts`,
 * so generated and committed YAML cannot drift.
 */
export function buildServiceOpenApiYaml(
  info: OasInfo,
  operations: readonly OasOperation[],
  servers: readonly OasServer[],
): string {
  return stringifyOpenApi(buildOpenApiDocument(info, operations, servers))
}

import {
  type AsyncChannel,
  type AsyncInfo,
  type AsyncServer,
  buildAsyncApiDocument,
  stringifyAsyncApi,
} from '@qaroom/contracts'

/**
 * A service's AsyncAPI YAML: its Zod-registered event payload schemas plus the channels it
 * owns, serialized deterministically. Mirrors `buildServiceOpenApiYaml` so generated and
 * committed YAML cannot drift (the AsyncAPI drift gate regenerates and compares).
 */
export function buildServiceAsyncApiYaml(
  info: AsyncInfo,
  channels: readonly AsyncChannel[],
  servers: readonly AsyncServer[],
): string {
  return stringifyAsyncApi(buildAsyncApiDocument(info, channels, servers))
}

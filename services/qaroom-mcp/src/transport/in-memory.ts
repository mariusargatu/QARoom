import type { McpCore } from '../server/core'
import type { McpClient } from './client'

/** In-memory transport: direct core calls. The substrate for unit / property / golden tests. */
export function inMemoryClient(core: McpCore): McpClient {
  return {
    listTools: async () => core.listTools(),
    callTool: (name, input) => core.callTool(name, input),
    listResources: async () => core.listResources(),
    readResource: (uri) => core.readResource(uri),
  }
}

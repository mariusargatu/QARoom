import { buildManifest } from '../manifest/build-manifest'
import { McpManifest } from '../schema/mcp'

/**
 * Deliberate manifest mutations for the breaking-change classifier tests (Gate 1).
 * Kept out of the test file so the mutation helpers can use ordinary control flow.
 */
export const baseManifest = buildManifest()

function requireFirstTool() {
  const tool = baseManifest.tools[0]
  if (!tool) throw new Error('manifest has no tools to mutate')
  return tool
}

export function manifestWithoutFirstTool(): McpManifest {
  return McpManifest.parse({ ...baseManifest, tools: baseManifest.tools.slice(1) })
}

export function manifestWithExtraTool(): McpManifest {
  const synthetic = { ...requireFirstTool(), name: 'content_synthetic' }
  return McpManifest.parse({ ...baseManifest, tools: [...baseManifest.tools, synthetic] })
}

export function manifestWithAddedRequired(): McpManifest {
  const first = requireFirstTool()
  const required = (first.input_schema.required as string[] | undefined) ?? []
  const input_schema = { ...first.input_schema, required: [...required, 'extra'] }
  return McpManifest.parse({
    ...baseManifest,
    tools: [{ ...first, input_schema }, ...baseManifest.tools.slice(1)],
  })
}

export function manifestWithChangedType(): McpManifest {
  const first = requireFirstTool()
  const properties = (first.input_schema.properties as Record<string, unknown> | undefined) ?? {}
  const required = (first.input_schema.required as string[] | undefined) ?? []
  const key = required[0] ?? Object.keys(properties)[0]
  if (!key) throw new Error('tool has no input property to mutate')
  const input_schema = {
    ...first.input_schema,
    properties: { ...properties, [key]: { type: 'integer' } },
  }
  return McpManifest.parse({
    ...baseManifest,
    tools: [{ ...first, input_schema }, ...baseManifest.tools.slice(1)],
  })
}

export function manifestWithRemovedInputProperty(): McpManifest {
  const first = requireFirstTool()
  const properties = (first.input_schema.properties as Record<string, unknown> | undefined) ?? {}
  const required = (first.input_schema.required as string[] | undefined) ?? []
  const key = Object.keys(properties)[0]
  if (!key) throw new Error('tool has no input property to remove')
  const trimmed = Object.fromEntries(Object.entries(properties).filter(([name]) => name !== key))
  const input_schema = {
    ...first.input_schema,
    properties: trimmed,
    required: required.filter((name) => name !== key),
  }
  return McpManifest.parse({
    ...baseManifest,
    tools: [{ ...first, input_schema }, ...baseManifest.tools.slice(1)],
  })
}

export function manifestWithChangedToolPath(): McpManifest {
  const first = requireFirstTool()
  return McpManifest.parse({
    ...baseManifest,
    tools: [{ ...first, path: `${first.path}/moved` }, ...baseManifest.tools.slice(1)],
  })
}

export function manifestWithChangedToolMethod(): McpManifest {
  const first = requireFirstTool()
  const method = first.method === 'GET' ? 'POST' : 'GET'
  return McpManifest.parse({
    ...baseManifest,
    tools: [{ ...first, method }, ...baseManifest.tools.slice(1)],
  })
}

export function manifestWithChangedResourceMime(): McpManifest {
  const first = baseManifest.resources[0]
  if (!first) throw new Error('manifest has no resources to mutate')
  return McpManifest.parse({
    ...baseManifest,
    resources: [{ ...first, mime_type: 'application/xml' }, ...baseManifest.resources.slice(1)],
  })
}

export function manifestWithoutFirstResource(): McpManifest {
  return McpManifest.parse({ ...baseManifest, resources: baseManifest.resources.slice(1) })
}

export function manifestWithBumpedProtocol(): McpManifest {
  return McpManifest.parse({ ...baseManifest, protocol_version: '2099-01-01' })
}

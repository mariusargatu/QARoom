import type { McpManifest, McpToolDef } from '../schema/mcp'

/**
 * A typed breaking-change classifier for the tool manifest — the MCP analogue of the
 * oasdiff gate (ADR-0006). Direction: tools are consumed by calling agents, so a change
 * that can break an existing call is breaking; a change that only widens the surface is not.
 */
export type ManifestChangeKind =
  | 'tool-removed'
  | 'tool-added'
  | 'tool-path-changed'
  | 'tool-method-changed'
  | 'resource-removed'
  | 'resource-added'
  | 'resource-mime-type-changed'
  | 'required-input-added'
  | 'required-input-removed'
  | 'input-property-removed'
  | 'input-type-changed'
  | 'protocol-version-changed'

export interface ManifestChange {
  kind: ManifestChangeKind
  detail: string
  breaking: boolean
}

function toolMap(manifest: McpManifest): Map<string, McpToolDef> {
  return new Map(manifest.tools.map((tool) => [tool.name, tool]))
}

function requiredOf(tool: McpToolDef): string[] {
  const required = (tool.input_schema as { required?: unknown }).required
  return Array.isArray(required) ? required.filter((x): x is string => typeof x === 'string') : []
}

function propType(tool: McpToolDef, prop: string): string | undefined {
  const properties = (tool.input_schema as { properties?: Record<string, unknown> }).properties
  const entry = properties?.[prop] as { type?: unknown } | undefined
  return typeof entry?.type === 'string' ? entry.type : undefined
}

function diffTool(base: McpToolDef, revision: McpToolDef): ManifestChange[] {
  const changes: ManifestChange[] = []
  // A same-named tool that moves endpoint or verb breaks callers with the old contract.
  if (base.path !== revision.path) {
    changes.push({
      kind: 'tool-path-changed',
      detail: `${revision.name} path ${base.path} → ${revision.path}`,
      breaking: true,
    })
  }
  if (base.method !== revision.method) {
    changes.push({
      kind: 'tool-method-changed',
      detail: `${revision.name} method ${base.method} → ${revision.method}`,
      breaking: true,
    })
  }
  // A removed input property breaks callers still sending it (the schema is additionalProperties:false).
  const revProps = inputProps(revision)
  for (const prop of Object.keys(inputProps(base))) {
    if (!(prop in revProps)) {
      changes.push({
        kind: 'input-property-removed',
        detail: `${revision.name}.${prop} removed from the input schema`,
        breaking: true,
      })
    }
  }
  const baseRequired = new Set(requiredOf(base))
  const revRequired = new Set(requiredOf(revision))
  for (const prop of revRequired) {
    if (!baseRequired.has(prop)) {
      changes.push({
        kind: 'required-input-added',
        detail: `${revision.name}.${prop} is now required`,
        breaking: true,
      })
    }
  }
  for (const prop of baseRequired) {
    if (!revRequired.has(prop)) {
      changes.push({
        kind: 'required-input-removed',
        detail: `${revision.name}.${prop} is no longer required`,
        breaking: false,
      })
    }
  }
  const props = new Set([...Object.keys(inputProps(base)), ...Object.keys(inputProps(revision))])
  for (const prop of props) {
    const before = propType(base, prop)
    const after = propType(revision, prop)
    if (before !== undefined && after !== undefined && before !== after) {
      changes.push({
        kind: 'input-type-changed',
        detail: `${revision.name}.${prop} type ${before} → ${after}`,
        breaking: true,
      })
    }
  }
  return changes
}

function inputProps(tool: McpToolDef): Record<string, unknown> {
  const properties = (tool.input_schema as { properties?: Record<string, unknown> }).properties
  return properties ?? {}
}

/** Classify the changes from `base` to `revision`. Empty ⇒ identical surface. */
export function classifyManifestChanges(
  base: McpManifest,
  revision: McpManifest,
): ManifestChange[] {
  const changes: ManifestChange[] = []

  if (base.protocol_version !== revision.protocol_version) {
    changes.push({
      kind: 'protocol-version-changed',
      detail: `protocol_version ${base.protocol_version} → ${revision.protocol_version}`,
      breaking: true,
    })
  }

  const baseTools = toolMap(base)
  const revTools = toolMap(revision)
  for (const [name, tool] of baseTools) {
    const revision_tool = revTools.get(name)
    if (!revision_tool) {
      changes.push({ kind: 'tool-removed', detail: `tool ${name} removed`, breaking: true })
      continue
    }
    changes.push(...diffTool(tool, revision_tool))
  }
  for (const name of revTools.keys()) {
    if (!baseTools.has(name)) {
      changes.push({ kind: 'tool-added', detail: `tool ${name} added`, breaking: false })
    }
  }

  const baseResources = new Map(base.resources.map((r) => [r.uri, r]))
  const revResources = new Map(revision.resources.map((r) => [r.uri, r]))
  for (const uri of baseResources.keys()) {
    if (!revResources.has(uri)) {
      changes.push({ kind: 'resource-removed', detail: `resource ${uri} removed`, breaking: true })
    }
  }
  for (const [uri, revRes] of revResources) {
    const baseRes = baseResources.get(uri)
    if (!baseRes) {
      changes.push({ kind: 'resource-added', detail: `resource ${uri} added`, breaking: false })
      continue
    }
    // A mime change breaks a client that parses the resource as the old type.
    if (baseRes.mime_type !== revRes.mime_type) {
      changes.push({
        kind: 'resource-mime-type-changed',
        detail: `resource ${uri} mime ${baseRes.mime_type} → ${revRes.mime_type}`,
        breaking: true,
      })
    }
  }

  return changes
}

/** The breaking subset — what the verify gate fails on. */
export function breakingManifestChanges(
  base: McpManifest,
  revision: McpManifest,
): ManifestChange[] {
  return classifyManifestChanges(base, revision).filter((change) => change.breaking)
}

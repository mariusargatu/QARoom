import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { McpManifest } from '../schema/mcp'
import { buildManifest, stringifyManifest } from './build-manifest'

const committedPath = resolve(import.meta.dirname, '..', '..', 'mcp-manifest.json')

describe('the MCP tool manifest', () => {
  it('matches what the operation registries regenerate, byte for byte', () => {
    const committed = readFileSync(committedPath, 'utf8')
    expect(stringifyManifest(buildManifest())).toBe(committed)
  })

  it('validates against the McpManifest contract', () => {
    expect(() => McpManifest.parse(buildManifest())).not.toThrow()
  })

  it('lists tools in a deterministic name order', () => {
    const names = buildManifest().tools.map((tool) => tool.name)
    expect(names).toEqual([...names].sort())
  })

  it('exposes only non-mutating, non-system operations as tools', () => {
    const tools = buildManifest().tools
    expect(tools.every((tool) => tool.mutating === false)).toBe(true)
    expect(tools.some((tool) => tool.path.startsWith('/system/'))).toBe(false)
  })

  it('gives every tool a closed object input_schema', () => {
    for (const tool of buildManifest().tools) {
      const schema = tool.input_schema as { type?: string; additionalProperties?: boolean }
      expect(schema.type, tool.name).toBe('object')
      expect(schema.additionalProperties, tool.name).toBe(false)
    }
  })
})

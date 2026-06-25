import { describe, expect, it } from 'vitest'
import { setupMcpInMemory } from '../test-support/harness'
import { buildResourceEntries } from './resources'

/**
 * The read resource surface (ADR-0006). Holds the read-path coverage that previously lived only in the
 * (deleted) agentic-CI fleet-eval spec: that `listResources()` matches the registry exactly, and that
 * every registered resource — including the gateway `/system/limits` usage read, whose only reader this
 * was — resolves to a structured `ok` outcome on the tested in-memory substrate.
 */
const REGISTERED_URIS = buildResourceEntries().map((entry) => entry.def.uri)

describe('the MCP read resource surface', () => {
  it('lists exactly the registered resource URIs (registry drift gate)', async () => {
    const { client } = setupMcpInMemory()
    const listed = (await client.listResources()).map((resource) => resource.uri).sort()
    expect(listed).toEqual([...REGISTERED_URIS].sort())
  })

  it('reads every registered resource to a structured ok outcome', async () => {
    const { client } = setupMcpInMemory()
    const outcomes = await Promise.all(
      REGISTERED_URIS.map(async (uri) => ({ uri, ok: (await client.readResource(uri)).ok })),
    )
    expect(outcomes).toEqual(REGISTERED_URIS.map((uri) => ({ uri, ok: true })))
  })
})

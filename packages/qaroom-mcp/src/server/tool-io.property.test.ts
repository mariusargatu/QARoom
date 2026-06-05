import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { OPERATIONS as CONTENT_OPS } from '@qaroom/content/operations'
import { type Capabilities, LamportGate, type OasOperation } from '@qaroom/contracts'
import { OPERATIONS as GATEWAY_OPS } from '@qaroom/gateway/operations'
import { buildCapabilities } from '@qaroom/service-kit'
import { createSeededDeps } from '@qaroom/testing-utils/harness'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { buildManifest } from '../manifest/build-manifest'
import { invalidExtraFieldArb, validInputArb } from '../test-support/arbitraries'
import { setupMcpInMemory } from '../test-support/harness'

const manifest = buildManifest()
const harness = setupMcpInMemory()
const READ_TOOLS = manifest.tools.filter((tool) => tool.service !== 'qaroom')

function contentOf(outcome: Record<string, unknown>): unknown {
  return outcome.content
}
function requestIdOf(outcome: Record<string, unknown>): unknown {
  return outcome.request_id
}
interface OpenApiDoc {
  paths: Record<string, Record<string, { operationId?: string }>>
}
const SERVICES = ['content', 'gateway'] as const

function opsFor(service: string): readonly OasOperation[] {
  return service === 'content' ? CONTENT_OPS : GATEWAY_OPS
}

// Built once per suite — the /system/capabilities payload and the published openapi.yaml are
// static, so the cross-checks read from these maps instead of recomputing per tool.
const CAPS_BY_SERVICE: Record<string, Capabilities> = Object.fromEntries(
  SERVICES.map((service) => {
    const { clock, ids } = createSeededDeps()
    return [service, buildCapabilities(service, opsFor(service), clock, new LamportGate(ids))]
  }),
)
const OPENAPI_BY_SERVICE: Record<string, OpenApiDoc> = Object.fromEntries(
  SERVICES.map((service) => {
    const path = resolve(
      import.meta.dirname,
      '..',
      '..',
      '..',
      '..',
      'services',
      service,
      'openapi.yaml',
    )
    return [service, parseYaml(readFileSync(path, 'utf8')) as OpenApiDoc]
  }),
)

describe('tool I/O ranges over each tool JSON Schema', () => {
  for (const tool of READ_TOOLS) {
    it(`accepts schema-valid input and proxies a result for ${tool.name}`, async () => {
      await fc.assert(
        fc.asyncProperty(validInputArb(tool.input_schema), async (input) => {
          const outcome = await harness.client.callTool(tool.name, input)
          expect(outcome.ok).toBe(true)
        }),
        { numRuns: 15 },
      )
    })

    it(`serves identical content for a repeated read of ${tool.name}`, async () => {
      await fc.assert(
        fc.asyncProperty(validInputArb(tool.input_schema), async (input) => {
          const first = await harness.client.callTool(tool.name, input)
          const second = await harness.client.callTool(tool.name, input)
          expect(JSON.stringify(contentOf(first))).toBe(JSON.stringify(contentOf(second)))
          expect(requestIdOf(first)).not.toBe(requestIdOf(second))
        }),
        { numRuns: 10 },
      )
    })

    it(`rejects input carrying an unexpected field for ${tool.name}`, async () => {
      await fc.assert(
        fc.asyncProperty(invalidExtraFieldArb(tool.input_schema), async (input) => {
          const outcome = await harness.client.callTool(tool.name, input)
          expect(outcome.ok).toBe(false)
        }),
        { numRuns: 10 },
      )
    })
  }
})

describe('the manifest cross-checks against the live contracts', () => {
  it('matches each tool input_schema to its /system/capabilities input_schema', () => {
    for (const tool of READ_TOOLS) {
      const cap = CAPS_BY_SERVICE[tool.service]?.capabilities.find(
        (candidate) => candidate.operation_id === tool.operation_id,
      )
      expect(tool.input_schema).toEqual(cap?.input_schema)
    }
  })

  it('maps each tool to an operation in the published openapi.yaml', () => {
    for (const tool of READ_TOOLS) {
      const operation =
        OPENAPI_BY_SERVICE[tool.service]?.paths[tool.path]?.[tool.method.toLowerCase()]
      expect(operation?.operationId).toBe(tool.operation_id)
    }
  })
})

// The conventions tool is synthetic (no OpenAPI operation), so it is excluded from the
// cross-checks above — it is contract-checked here, through the core's own input validation.
describe('the conventions tool through the MCP core', () => {
  it('returns an ok outcome for a schema-valid request', async () => {
    const outcome = await harness.client.callTool('qaroom_conventionsCheck', {
      code: 'export const value = 1',
    })
    expect(outcome.ok).toBe(true)
  })

  it('rejects a request that omits the required code field', async () => {
    const outcome = await harness.client.callTool('qaroom_conventionsCheck', {})
    expect(outcome.ok).toBe(false)
  })
})

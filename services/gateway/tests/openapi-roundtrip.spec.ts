import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { gatewayOpenApiYaml } from '../src/openapi-document'

describe('gateway openapi contract round-trip', () => {
  it('the committed openapi.yaml is byte-identical to what Zod and the operation registry generate', () => {
    const regenerated = gatewayOpenApiYaml()
    const committed = readFileSync(resolve(import.meta.dirname, '..', 'openapi.yaml'), 'utf8')
    expect(regenerated).toBe(committed)
  })
})

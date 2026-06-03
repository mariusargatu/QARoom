import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contentOpenApiYaml } from '../src/openapi-document'

describe('openapi contract round-trip', () => {
  it('the committed openapi.yaml is byte-identical to what Zod and the operation registry generate', () => {
    const regenerated = contentOpenApiYaml()
    const committed = readFileSync(resolve(import.meta.dirname, '..', 'openapi.yaml'), 'utf8')
    expect(regenerated).toBe(committed)
  })
})

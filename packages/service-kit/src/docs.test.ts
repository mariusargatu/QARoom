import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AsyncInfo, OasInfo } from '@qaroom/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildServiceAsyncApiYaml } from './asyncapi'
import { writeDoc } from './build-doc'
import { buildServiceOpenApiYaml } from './openapi'

const OAS_INFO: OasInfo = { title: 'Demo', version: '1.0.0', description: 'A demo service' }
const ASYNC_INFO: AsyncInfo = { title: 'Demo', version: '1.0.0', description: 'A demo service' }

describe('buildServiceOpenApiYaml', () => {
  it('serializes a deterministic OpenAPI YAML document from info + operations + servers', () => {
    const yaml = buildServiceOpenApiYaml(
      OAS_INFO,
      [],
      [{ url: 'http://localhost', description: 'local' }],
    )
    expect(yaml).toContain('openapi:')
    expect(yaml).toContain('title: Demo')
    // Pure function: identical inputs serialize byte-for-byte identically (the drift gate's premise).
    expect(buildServiceOpenApiYaml(OAS_INFO, [], [])).toBe(
      buildServiceOpenApiYaml(OAS_INFO, [], []),
    )
  })
})

describe('buildServiceAsyncApiYaml', () => {
  it('serializes a deterministic AsyncAPI YAML document from info + channels + servers', () => {
    const yaml = buildServiceAsyncApiYaml(ASYNC_INFO, [], [])
    expect(yaml).toContain('asyncapi:')
    expect(yaml).toContain('title: Demo')
    expect(buildServiceAsyncApiYaml(ASYNC_INFO, [], [])).toBe(
      buildServiceAsyncApiYaml(ASYNC_INFO, [], []),
    )
  })
})

describe('writeDoc', () => {
  const dirs: string[] = []
  afterEach(() => {
    vi.restoreAllMocks()
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  it('writes the rendered document to the kind-named YAML beside the script and logs its path', () => {
    const root = mkdtempSync(join(tmpdir(), 'service-kit-doc-'))
    dirs.push(root)
    const scriptDir = join(root, 'src')
    const writes: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      writes.push(String(chunk))
      return true
    })

    writeDoc(scriptDir, 'openapi', () => 'openapi: 3.0.0\n')

    const expectedPath = resolve(scriptDir, '..', 'openapi.yaml')
    expect(readFileSync(expectedPath, 'utf8')).toBe('openapi: 3.0.0\n')
    expect(writes.join('')).toContain(`wrote ${expectedPath}`)
  })

  it('uses the kind to name the output file (asyncapi.yaml)', () => {
    const root = mkdtempSync(join(tmpdir(), 'service-kit-doc-'))
    dirs.push(root)
    const scriptDir = join(root, 'src')
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)

    writeDoc(scriptDir, 'asyncapi', () => 'asyncapi: 3.0.0\n')

    expect(readFileSync(resolve(scriptDir, '..', 'asyncapi.yaml'), 'utf8')).toBe(
      'asyncapi: 3.0.0\n',
    )
  })
})

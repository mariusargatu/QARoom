import { describe, expect, it } from 'vitest'
import { defineServiceConfig } from './vitest-config'

interface ResolvedConfig {
  test: {
    coverage: { provider: string; reporter: string[]; include: string[] }
    setupFiles: string[]
    maxWorkers?: number
    testTimeout: number
  }
}

describe('defineServiceConfig', () => {
  it('produces a v8-coverage config with json-summary + the shared determinism setup', () => {
    const cfg = defineServiceConfig() as unknown as ResolvedConfig
    expect(cfg.test.coverage.provider).toBe('v8')
    expect(cfg.test.coverage.reporter).toContain('json-summary')
    expect(cfg.test.coverage.include).toContain('src/**/*.ts')
    expect(cfg.test.setupFiles).toContain('@qaroom/testing-utils/setup')
    expect(cfg.test.maxWorkers).toBe(2)
  })

  it('the pact variant drops the 2-worker cap and uses a flat budget', () => {
    const cfg = defineServiceConfig({ pact: true }) as unknown as ResolvedConfig
    expect(cfg.test.maxWorkers).toBeUndefined()
    expect(cfg.test.testTimeout).toBe(60_000)
  })
})

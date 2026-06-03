import { describe, expect, it } from 'vitest'
import { startTelemetry } from './start-telemetry'

describe('startTelemetry', () => {
  it('is a no-op that starts no SDK when disabled, keeping test suites deterministic', async () => {
    const handle = startTelemetry({ serviceName: 'demo', enabled: false })
    await expect(handle.shutdown()).resolves.toBeUndefined()
  })
})

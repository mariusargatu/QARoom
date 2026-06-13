import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setupMcpInMemory } from '../test-support/harness'
import { runGoldenTranscript, serializeTranscript } from '../test-support/transcript'

const goldenPath = resolve(import.meta.dirname, 'golden-transcript.json')

describe('the determinism-trio golden transcript', () => {
  it('is byte-identical across two independently seeded runs', async () => {
    const first = serializeTranscript(await runGoldenTranscript(setupMcpInMemory().client))
    const second = serializeTranscript(await runGoldenTranscript(setupMcpInMemory().client))
    expect(first).toBe(second)
  })

  it('matches the committed golden transcript', async () => {
    const produced = serializeTranscript(await runGoldenTranscript(setupMcpInMemory().client))
    expect(produced).toBe(readFileSync(goldenPath, 'utf8'))
  })
})

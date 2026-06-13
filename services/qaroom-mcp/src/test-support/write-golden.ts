import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setupMcpInMemory } from './harness'
import { runGoldenTranscript, serializeTranscript } from './transcript'

/** Regenerate the committed golden transcript (run after an intentional behavior change). */
const outPath = resolve(import.meta.dirname, '..', 'server', 'golden-transcript.json')
const steps = await runGoldenTranscript(setupMcpInMemory().client)
writeFileSync(outPath, serializeTranscript(steps))
process.stdout.write(`wrote ${outPath}\n`)

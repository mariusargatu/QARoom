import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * Run EvoMaster v6 black-box search-based fuzzing against a running content-service, emitting
 * JS_JEST tests for review (ADR-0016). The M0 spike validated this against TS Fastify
 * (docs/spikes/01-evomaster.md). Hardened flags vs the spike: a fixed --seed (reproducible), a
 * 10-minute budget (the 45s spike was below the useful floor), and NO --ratePerMinute (throttling
 * on localhost is harmful). Generated output is a disposable review artifact — findings are
 * hand-reified into the regression catalog; the raw suite is gitignored.
 *
 * Requires: Java 17+, a running content-service (CONTENT_BASE_URL), and the v6.0.0 jar (downloaded
 * on first run to .evomaster/, or supplied via EVOMASTER_JAR).
 */
const ROOT = process.cwd()
const VERSION = 'v6.0.0'
const JAR_URL = `https://github.com/WebFuzzing/EvoMaster/releases/download/${VERSION}/evomaster.jar`
const jar = process.env.EVOMASTER_JAR ?? resolve(ROOT, '.evomaster/evomaster.jar')
const base = process.env.CONTENT_BASE_URL ?? 'http://localhost:8081'
const schema = resolve(ROOT, 'services/content/openapi.yaml')
const outputFolder = resolve(ROOT, 'services/content/tests/evomaster-generated')
const maxTime = process.env.EVOMASTER_MAX_TIME ?? '10m'

if (!existsSync(jar)) {
  process.stdout.write(`downloading EvoMaster ${VERSION} jar → ${jar}\n`)
  mkdirSync(dirname(jar), { recursive: true })
  execFileSync('curl', ['-fSL', '-o', jar, JAR_URL], { stdio: 'inherit' })
}

mkdirSync(outputFolder, { recursive: true })

execFileSync(
  'java',
  [
    '-jar',
    jar,
    '--blackBox',
    'true',
    '--schema',
    `file://${schema}`,
    '--base',
    base,
    '--outputFormat',
    'JS_JEST',
    '--outputFolder',
    outputFolder,
    '--seed',
    process.env.EVOMASTER_SEED ?? '42',
    '--maxTime',
    maxTime,
    '--schemaOracles',
    'true',
    '--blackBoxCleanUp',
    'true',
  ],
  { stdio: 'inherit' },
)

process.stdout.write(`EvoMaster wrote generated tests to ${outputFolder}\n`)

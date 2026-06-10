import { spawnSync } from 'node:child_process'
import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { foldRunner } from './lib/fold-runner'

/**
 * Run Pact provider verification for every known provider and fold the outcome into the frozen
 * test-results/summary.json envelope as a `pact` runner. Until now the five `pnpm pact:verify`
 * invocations lived only as separate CI steps, so the contract layer never appeared in the
 * summary at all (the gauntlet's "evidence fragmentation" gap). The schema is do-not-touch;
 * pact rides the extensible per-runner `output`.
 *
 *   pnpm pact:results              # verify all five providers, fold, exit non-zero on any red
 *   pnpm pact:results --provider X # single provider (debugging)
 */
const ROOT = process.cwd()
const summaryPath = resolve(ROOT, 'test-results/summary.json')

// Mirrors KNOWN_PROVIDERS in scripts/pact-verify.ts (kept local there because that script
// process.exits at top level; importing it would execute it).
const PROVIDERS = ['content', 'identity', 'donations', 'flags', 'webhooks']

const args = process.argv.slice(2)
const providerIdx = args.indexOf('--provider')
const only = providerIdx >= 0 ? args[providerIdx + 1] : undefined
const providers = only ? PROVIDERS.filter((p) => p === only) : PROVIDERS

if (providers.length === 0) {
  process.stderr.write(`unknown provider "${only}" — known: ${PROVIDERS.join(', ')}\n`)
  process.exit(2)
}

const pactFilesFor = (provider: string): string[] =>
  globSync('services/*/pacts/*.json', { cwd: ROOT }).filter(
    (f) => JSON.parse(readFileSync(resolve(ROOT, f), 'utf8')).provider?.name === provider,
  )

const results = providers.map((provider) => {
  process.stdout.write(`▶ pact:verify --provider ${provider}\n`)
  const started = Date.now()
  const run = spawnSync('pnpm', ['pact:verify', '--provider', provider], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  const duration_ms = Date.now() - started
  const passed = run.status === 0
  if (!passed) {
    const tail = `${run.stdout ?? ''}${run.stderr ?? ''}`.split('\n').slice(-12).join('\n')
    process.stderr.write(`✗ provider ${provider} failed verification:\n${tail}\n`)
  }
  return { provider, passed, pact_files: pactFilesFor(provider).length, duration_ms }
})

const failed = results.filter((r) => !r.passed).length
const pactRunner = {
  name: 'pact',
  passed: results.length - failed,
  failed,
  skipped: 0,
  duration_ms: results.reduce((sum, r) => sum + r.duration_ms, 0),
  output: { runner: 'pact-v4-monorepo-broker', success: failed === 0, providers: results },
  seeds: {},
}

foldRunner(summaryPath, pactRunner)
process.stdout.write(
  `merged pact runner into summary.json — ${pactRunner.passed} provider(s) passed, ${failed} failed\n`,
)
process.exit(failed === 0 ? 0 : 1)

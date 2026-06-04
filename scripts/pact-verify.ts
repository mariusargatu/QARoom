import { execFileSync } from 'node:child_process'
import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Monorepo-as-broker pact discovery + verification (Commitment 3, Milestone 1).
 *
 *   pnpm pact:verify --provider <name>
 *
 * Scans `services/*\/pacts/*.json` for files naming <name> as provider and runs
 * that provider's `tests/contracts/provider.verify.ts`. No external Pact Broker —
 * one commit changes a consumer's expectation and the provider together.
 */
const ROOT = process.cwd()
const args = process.argv.slice(2)
const providerIdx = args.indexOf('--provider')
const provider = providerIdx >= 0 ? args[providerIdx + 1] : undefined

if (!provider) {
  process.stderr.write('usage: pnpm pact:verify --provider <name>\n')
  process.exit(2)
}

// Providers that MUST have at least one committed consumer pact. Zero pacts for one of
// these means the consumer test never ran or the pact was not committed — NOT that there
// is genuinely nothing to verify. The gate fails loudly instead of going false-green on a
// clean CI checkout (the artifact-lifecycle hole a glob-as-broker is otherwise prone to).
const KNOWN_PROVIDERS = new Set(['content', 'identity', 'donations', 'flags'])

const pactFiles = globSync('services/*/pacts/*.json', { cwd: ROOT }).filter(
  (f) => JSON.parse(readFileSync(resolve(ROOT, f), 'utf8')).provider?.name === provider,
)

if (pactFiles.length === 0) {
  if (KNOWN_PROVIDERS.has(provider)) {
    process.stderr.write(
      `no pact files name "${provider}" as provider, but it has known consumers — the pact is ` +
        `missing or uncommitted. Commit services/*/pacts/*.json (monorepo-as-broker, docs/05).\n`,
    )
    process.exit(1)
  }
  process.stdout.write(`no pact files name "${provider}" as provider — nothing to verify\n`)
  process.exit(0)
}

process.stdout.write(
  `verifying ${pactFiles.length} pact(s) against provider "${provider}":\n${pactFiles.map((f) => `  - ${f}`).join('\n')}\n`,
)

execFileSync(
  'pnpm',
  ['--filter', `@qaroom/${provider}`, 'exec', 'tsx', 'tests/contracts/provider.verify.ts'],
  {
    cwd: ROOT,
    stdio: 'inherit',
  },
)

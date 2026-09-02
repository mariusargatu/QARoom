import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Where consumer specs write their pacts, and which package regenerates each set.
 *
 * These files are COMMITTED (monorepo-as-broker, `scripts/pact-verify.ts`) and provider
 * verification globs them — so they are a derived artifact that a gate reads. Nothing regenerated
 * or diffed them, and pact-core writes in MERGE mode (`writePactFile(dir, merge = true)`, and
 * `PactV4` never passes the flag), so a committed pact can only ever grow: delete a consumer spec
 * and its interactions persist in the JSON forever, verified against a contract nobody consumes.
 * Merge mode is why a naive `git diff --exit-code` is not enough on its own — the regenerate step
 * must CLEAR the directory first so the file is a pure function of the specs that exist today.
 */
export interface PactArtifactSet {
  /** pnpm filter that regenerates this set. */
  pkg: string
  /** Vitest path (relative to the package) holding the consumer specs. */
  specs: string
  /** Repo-relative directory the pacts land in. */
  dir: string
  /**
   * `http` — synchronous interactions, replayed by `pact:verify` against a booted provider and
   * cross-checked against that provider's `openapi.yaml`.
   * `message` — NATS envelopes. There is no OpenAPI to cross-check (the async contract lives in
   * `asyncapi.yaml`), and verification is the provider's own in-process spec, which drains the real
   * outbox relay and checks the captured envelope. The distinction matters: the cross-check census
   * must not demand a `pact-oas-crosscheck.spec.ts` for a provider that only has message pacts.
   */
  kind: 'http' | 'message'
}

export const PACT_ARTIFACTS: readonly PactArtifactSet[] = [
  { pkg: '@qaroom/gateway', specs: 'tests/contracts', dir: 'services/gateway/pacts', kind: 'http' },
  // The REAL async consumers (2026-08-11). Previously one `message` set lived under content and was
  // written by `community-projection`, a consumer that did not exist; the two services that actually
  // bind these subjects had no contract. A consumer owns its pact, so each set sits in the consumer.
  {
    pkg: '@qaroom/webhooks',
    specs: 'tests/contracts',
    dir: 'services/webhooks/tests/contracts/pacts',
    kind: 'message',
  },
  {
    pkg: '@qaroom/donations',
    specs: 'tests/contracts',
    dir: 'services/donations/tests/contracts/pacts',
    kind: 'message',
  },
]

/** The committed pact JSON files in one set, sorted. Empty when the directory is absent. */
export function pactFilesIn(root: string, dir: string): string[] {
  const abs = resolve(root, dir)
  if (!existsSync(abs)) return []
  return readdirSync(abs)
    .filter((f) => f.endsWith('.json'))
    .sort()
}

/**
 * Every committed pact across all sets, as repo-relative paths. The drift gate asserts this is
 * non-empty before trusting a clean diff — an empty set would otherwise make "no drift" vacuous.
 */
export function allCommittedPacts(root: string): string[] {
  return PACT_ARTIFACTS.flatMap((set) =>
    pactFilesIn(root, set.dir).map((file) => `${set.dir}/${file}`),
  )
}

/**
 * The distinct provider names the committed HTTP pacts declare, sorted. Derived from the files
 * rather than hand-listed, so a new provider joins every provider-keyed gate (today: the Pact ↔
 * OpenAPI cross-check census) without anyone remembering to extend a list.
 *
 * `message` sets are excluded: their contract is an AsyncAPI channel, not an OpenAPI operation, so
 * demanding a `pact-oas-crosscheck.spec.ts` for them would be asking for a check that cannot exist.
 *
 * Lives here, not in the census spec, because the missing-name guard below is a conditional and
 * `qaroom/no-conditional-in-test` forbids branching inside a test file — the rule that keeps
 * assertions single-branch. A pact with no `provider.name` is a malformed artifact, not a case to
 * silently skip: skipping it would drop that provider out of the census entirely.
 */
export function pactProviders(root: string): string[] {
  const httpPacts = PACT_ARTIFACTS.filter((set) => set.kind === 'http').flatMap((set) =>
    pactFilesIn(root, set.dir).map((file) => `${set.dir}/${file}`),
  )
  const names = httpPacts.map((rel) => {
    const pact = JSON.parse(readFileSync(resolve(root, rel), 'utf8')) as {
      provider?: { name?: string }
    }
    const name = pact.provider?.name
    if (name === undefined) throw new Error(`${rel}: pact declares no provider.name`)
    return name
  })
  return [...new Set(names)].sort()
}

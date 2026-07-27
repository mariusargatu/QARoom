import { existsSync, readdirSync } from 'node:fs'
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
}

export const PACT_ARTIFACTS: readonly PactArtifactSet[] = [
  { pkg: '@qaroom/gateway', specs: 'tests/contracts', dir: 'services/gateway/pacts' },
  {
    pkg: '@qaroom/content',
    specs: 'tests/contracts',
    dir: 'services/content/tests/contracts/pacts',
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

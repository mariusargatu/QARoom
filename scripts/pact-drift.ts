import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { allCommittedPacts, PACT_ARTIFACTS } from './lib/pact-artifacts'

/**
 * The pact drift gate — the contract mirror of `openapi-verify.ts`'s drift half.
 *
 * Committed pacts are a DERIVED artifact that another gate reads: `pact-verify.ts` globs
 * `services/*​/pacts/*.json` and verifies providers against whatever is on disk. Nothing
 * regenerated them, so a consumer expectation could change (or a whole consumer spec be deleted)
 * while provider verification kept passing against a stale contract.
 *
 * Merge mode is why this cannot just be `git diff --exit-code`: pact-core writes with
 * `writePactFile(dir, merge = true)` and `PactV4` never passes the flag (pact-core 19.2.0,
 * `src/consumer/index.js:67`), so regeneration can add and update interactions but NEVER remove
 * one. Delete `identity.consumer.spec.ts` entirely and all 7 interactions survive in the JSON.
 * So: CLEAR each directory, regenerate from the specs that exist today, then diff. That makes the
 * committed pact a pure function of the specs.
 *
 * On drift the regenerated files are LEFT in place — same contract as the OpenAPI gate: the fix
 * is to commit them.
 *
 *   pnpm pact:drift
 */
const ROOT = process.cwd()

const before = allCommittedPacts(ROOT)
if (before.length === 0) {
  process.stderr.write(
    'pact drift gate: no committed pacts found — the gate would pass vacuously. Check PACT_ARTIFACTS.\n',
  )
  process.exit(2)
}

for (const set of PACT_ARTIFACTS) {
  // Clear first: merge mode cannot express a deletion, so a stale interaction would survive.
  rmSync(resolve(ROOT, set.dir), { recursive: true, force: true })
  execFileSync('pnpm', ['--filter', set.pkg, 'exec', 'vitest', 'run', set.specs], {
    cwd: ROOT,
    stdio: 'inherit',
  })
}

const after = allCommittedPacts(ROOT)
if (after.length === 0) {
  process.stderr.write(
    'pact drift gate: regeneration produced no pacts — the consumer specs did not run.\n',
  )
  process.exit(1)
}

const paths = PACT_ARTIFACTS.map((s) => s.dir)
try {
  // Diff against HEAD, not the index: a bare `git diff` only sees UNSTAGED changes, so staging a
  // stale pact would slip past. The claim being gated is "the COMMITTED pacts match".
  execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', ...paths], {
    cwd: ROOT,
    stdio: 'inherit',
  })
} catch {
  process.stderr.write(
    '\npact drift: the committed pacts do not match what the consumer specs generate. ' +
      'They have been regenerated — review and commit the result. A REMOVED interaction shows ' +
      'here as a deletion; merge-mode regeneration alone would have hidden it.\n',
  )
  process.exit(1)
}

process.stdout.write(
  `pact drift gate: ${after.length} committed pact(s) match a from-scratch regeneration ✓\n`,
)

import { execSync } from 'node:child_process'

/**
 * The DST replay contract (component 6): every failure is reproducible from `seed + commit`. When a
 * seed turns a real invariant red, the message carries both, so the exact world can be rebuilt and
 * the bug re-observed deterministically. The commit is read once (best-effort) — diagnostics only,
 * on the error path, so a missing git context never breaks a run.
 */

let cachedCommit: string | null = null

function gitCommit(): string {
  if (cachedCommit !== null) return cachedCommit
  const fromEnv = process.env.GITHUB_SHA ?? process.env.DST_COMMIT
  if (fromEnv) {
    cachedCommit = fromEnv.slice(0, 12)
    return cachedCommit
  }
  try {
    cachedCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    cachedCommit = 'unknown'
  }
  return cachedCommit
}

/** `seed=<n> commit=<sha>` — the replay coordinates stamped onto every red. */
export function replayTag(seed: number): string {
  return `seed=${seed} commit=${gitCommit()}`
}

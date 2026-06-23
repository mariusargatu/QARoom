/**
 * I/O layer for the auto-merge router (ADR-0026). Reads the diff and
 * CODEOWNERS, calls the PURE {@link classify}, and emits the result three ways:
 *   - JSON to stdout (for local inspection / piping)
 *   - `lane` + `reasons` to $GITHUB_OUTPUT (for the workflow to branch on)
 *   - a markdown block to $GITHUB_STEP_SUMMARY (the human-visible "why this lane")
 *
 * All git/fs/env lives HERE so pr-classify.ts stays pure and offline-testable. This file is the
 * thin shell; the decision is not made here.
 *
 * Usage: `tsx scripts/pr-classify-run.ts <baseSha> <headSha>`
 * In CI the SHAs come from the pull_request event; locally defaults to `origin/main...HEAD`.
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { type ChangedFile, classify, loadInvariantGlobs } from './pr-classify'

const repoRoot = resolve(import.meta.dirname, '..')

function git(args: readonly string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
}

/**
 * Parse `git diff --numstat` lines into {path, churn}. Binary files report `-` for added/deleted;
 * count those as 0 churn (they are not hand-authored line risk).
 *
 * ponytail: no `-M` rename detection — a rename shows as delete+add, which only ever inflates size
 * or boundary count (fails safe toward Lane B, never toward an undeserved auto-merge). Add `-M`
 * + the `{a => b}` path parse if rename-heavy PRs start tripping the cap.
 */
function parseNumstat(raw: string): ChangedFile[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [added, deleted, ...pathParts] = line.split('\t')
      const path = pathParts.join('\t')
      const churn = (added === '-' ? 0 : Number(added)) + (deleted === '-' ? 0 : Number(deleted))
      return { path, churn }
    })
}

function emitOutput(key: string, value: string): void {
  const out = process.env.GITHUB_OUTPUT
  if (!out) return
  // Multiline-safe heredoc form per GitHub Actions output spec.
  appendFileSync(out, `${key}<<__EOF__\n${value}\n__EOF__\n`)
}

function emitSummary(markdown: string): void {
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (!summary) return
  appendFileSync(summary, `${markdown}\n`)
}

const LANE_LABEL: Record<string, string> = {
  A: '🟩 Lane A — auto-merge eligible (no human)',
  B: '🟨 Lane B — human reads the summary, not the raw diff',
  C: '🟥 Lane C — Code Owner review (invariant source)',
}

function main(): void {
  const base = process.argv[2] ?? 'origin/main'
  const head = process.argv[3] ?? 'HEAD'
  const range = `${base}...${head}`

  const numstat = git(['diff', '--numstat', range])
  const files = parseNumstat(numstat)

  const codeowners = readFileSync(resolve(repoRoot, '.github/CODEOWNERS'), 'utf8')
  const invariantGlobs = loadInvariantGlobs(codeowners)

  const result = classify(files, invariantGlobs)

  // stdout: the machine-readable record.
  process.stdout.write(`${JSON.stringify({ ...result, fileCount: files.length, range })}\n`)

  // workflow branch inputs.
  emitOutput('lane', result.lane)
  emitOutput('reasons', result.reasons.join('\n'))

  // human-visible rationale.
  emitSummary(
    [
      `## Auto-merge router: ${LANE_LABEL[result.lane] ?? result.lane}`,
      '',
      `Compared \`${range}\` · ${files.length} changed file(s).`,
      '',
      '### Why',
      ...result.reasons.map((r) => `- ${r}`),
    ].join('\n'),
  )
}

// Only run when invoked directly, not if imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}

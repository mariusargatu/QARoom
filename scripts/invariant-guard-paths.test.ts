import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The invariant-guard workflow keeps TWO hand-authored path lists: `on.pull_request.paths` (what
// TRIGGERS the flag) and the `PATHS=` shell var (the diff filter that decides which changed files it
// actually reports). A path in the first but not the second silently escapes the guard — exactly the
// bug that let `**/stryker.config.json` trigger the workflow yet never be flagged. CODEOWNERS is the
// designated single source of the invariant-source set. This test pins the two YAML lists to each
// other and to CODEOWNERS, so the guard's own config can't drift again (the fix for the drift the
// 2026-07-10 audit found). Runs under vitest.scripts.config.ts via `pnpm test:scripts`.
// ponytail: derive PATHS from CODEOWNERS at runtime if the lists ever grow past hand-maintenance.
const ROOT = resolve(__dirname, '..')
const guardYml = readFileSync(resolve(ROOT, '.github/workflows/invariant-guard.yml'), 'utf8')
const codeowners = readFileSync(resolve(ROOT, '.github/CODEOWNERS'), 'utf8')

/** Reduce a glob/pathspec to the logical path it targets, so the three syntaxes compare equal. */
function canon(p: string): string {
  return p
    .replace(/^:\([^)]*\)/, '') // git pathspec magic, e.g. :(glob) / :(glob,top)
    .replace(/^\*\*\//, '') // leading **/ (match-at-any-depth)
    .replace(/^\//, '') // CODEOWNERS leading /
    .replace(/\/\*\*$/, '') // trailing /** (GitHub-glob directory)
    .replace(/\/$/, '') // PATHS trailing / (directory prefix)
}

// on.pull_request.paths: the `- '…'` entries between `paths:` and the next top-level key.
const pathsBlock = guardYml.slice(
  guardYml.indexOf('\n    paths:'),
  guardYml.indexOf('\npermissions:'),
)
const onPaths = [...pathsBlock.matchAll(/^\s+-\s+'([^']+)'/gm)].map((m) => canon(m[1]))

// The PATHS='…' diff-filter var, split on whitespace.
const pathsVar = guardYml.match(/PATHS='([^']+)'/)?.[1] ?? ''
const diffPaths = pathsVar.split(/\s+/).filter(Boolean).map(canon)

// CODEOWNERS: the first token of every non-comment, non-blank line.
const owned = new Set(
  codeowners
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
    .map((l) => canon(l.split(/\s+/)[0])),
)

describe('invariant-guard path lists cannot drift', () => {
  it('parses a non-trivial number of trigger paths (guard is not vacuously green)', () => {
    expect(onPaths.length).toBeGreaterThan(15)
  })

  it('the diff filter (PATHS) lists exactly the trigger paths (on.paths) — no path escapes the flag', () => {
    expect([...new Set(diffPaths)].sort()).toEqual([...new Set(onPaths)].sort())
  })

  it('every guarded path is a CODEOWNERS-owned invariant source (the single ownership source)', () => {
    expect(onPaths.filter((p) => !owned.has(p))).toEqual([])
  })
})

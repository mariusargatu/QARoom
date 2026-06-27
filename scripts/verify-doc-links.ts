import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * `pnpm links:check`: the relative-link-rot gate (sibling of tour:verify / census). The docs are a
 * dense web of relative cross-links — README -> ARCHITECTURE -> AGENTS -> docs/** -> ADRs. Nothing
 * verified that those links still resolve, so a renamed/moved file left a dead `[text](path)` behind
 * that reads as live until a human clicks it. This scans every git-tracked markdown file and asserts
 * each relative link target exists on disk.
 *
 *   SCOPE  every git-tracked *.md (gitignored local files like `.claude/` and `docs/journey/` are out
 *          of the published repo, so out of scope; symlinks like CLAUDE.md -> AGENTS.md are skipped so
 *          the same content isn't scanned twice).
 *   CHECK  for each `[text](target)` / `![alt](target)`, the path part of `target` resolves — relative
 *          to the file's dir, or to the repo root when it starts with `/`.
 *   SKIP   external (`http:`, `mailto:`, any `scheme:`), protocol-relative (`//`), and pure-anchor
 *          (`#frag`) links. Fenced code blocks are stripped first so example snippets don't trip it.
 *
 * ponytail: checks only that the PATH resolves, not the `#fragment` — GitHub heading-slug rules are
 * out of scope and brittle to mirror. tour:verify already pins `file:line` anchors in code-tour.md.
 * Add fragment validation here only if anchor-rot becomes a real class. No network: external URL
 * liveness is a separate, flaky concern that does not belong in the always-on verify lane.
 *
 * Exits non-zero on any unresolved link, naming the file + the dead target.
 */

const ROOT = process.cwd()

const LINK = /!?\[[^\]]*\]\(([^)]+)\)/g
const FENCE = /```[\s\S]*?```/g
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

export interface DeadLink {
  readonly file: string
  readonly target: string
}

/** Pull the raw link targets out of one markdown string, ignoring fenced code blocks. */
export function extractTargets(markdown: string): string[] {
  const body = markdown.replace(FENCE, '')
  const targets: string[] = []
  for (const m of body.matchAll(LINK)) {
    const raw = m[1]
    if (raw !== undefined) targets.push(raw)
  }
  return targets
}

/**
 * Classify a raw markdown link target. Returns the on-disk path to check for a local link, or `null`
 * for anything the gate deliberately ignores (external, protocol-relative, pure anchor).
 */
export function localPath(raw: string): string | null {
  // A markdown target can carry a title: `path "the title"`. Take the path token only.
  const target = raw.trim().split(/\s+/)[0] ?? ''
  if (target === '' || target.startsWith('#')) return null
  if (target.startsWith('//') || SCHEME.test(target)) return null
  const pathPart = target.split('#')[0]?.split('?')[0] ?? ''
  if (pathPart === '') return null
  try {
    return decodeURIComponent(pathPart)
  } catch {
    return pathPart
  }
}

/** Resolve a local link path against the file that contains it (or the repo root for `/`-absolute). */
export function resolveTarget(fromFile: string, path: string): string {
  return path.startsWith('/')
    ? resolve(ROOT, `.${path}`)
    : resolve(dirname(resolve(ROOT, fromFile)), path)
}

/**
 * Pure core: given the doc files and injected read/exists, return every dead relative link. No fs in
 * here so it stays offline-testable (see verify-doc-links.test.ts).
 */
export function findDeadLinks(
  files: readonly string[],
  read: (file: string) => string,
  exists: (absPath: string) => boolean,
): DeadLink[] {
  const dead: DeadLink[] = []
  for (const file of files) {
    for (const raw of extractTargets(read(file))) {
      const path = localPath(raw)
      if (path === null) continue
      if (!exists(resolveTarget(file, path))) dead.push({ file, target: raw.trim() })
    }
  }
  return dead
}

/** Every git-tracked *.md, minus symlinks (CLAUDE.md -> AGENTS.md would double-scan the same body). */
function markdownFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '--', '*.md'], { cwd: ROOT, encoding: 'utf8' })
  return out
    .split('\n')
    .filter((f) => f.length > 0)
    .filter((f) => !lstatSync(resolve(ROOT, f)).isSymbolicLink())
}

function main(): void {
  const files = markdownFiles().sort()
  const dead = findDeadLinks(
    files,
    (f) => readFileSync(resolve(ROOT, f), 'utf8'),
    (absPath) => existsSync(absPath),
  )
  process.stdout.write(`links:check: ${files.length} markdown file(s) scanned\n`)
  if (dead.length > 0) {
    for (const d of dead) process.stderr.write(`  ✗ ${d.file} -> ${d.target}\n`)
    process.stderr.write(
      `\nlinks:check FAILED: ${dead.length} dead relative link(s); fix the path or the moved file\n`,
    )
    process.exit(1)
  }
  process.stdout.write('links:check ✓: every relative doc link resolves on disk\n')
}

// Only run when invoked directly, not if imported by the test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}

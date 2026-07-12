import { existsSync, readFileSync } from 'node:fs'
import { relative } from 'node:path'

/**
 * The shared "committed artifact must equal a fresh render" whole-file drift gate, extracted from the
 * hand-rolled copies in render-adr-index.ts and stress-experiment.ts (the `--check` paths). Each pair
 * pins a committed file to the content a fresh render just produced; the byte comparison is the gate.
 *
 * An absent file fails loud on purpose: it can never byte-equal a rendered artifact, so it counts as
 * STALE rather than silently passing. On any mismatch it names every stale path on stderr with the
 * re-run hint and exits 1; otherwise it prints one ✓ summary on stdout and returns (exit 0). The
 * behaviour is identical for a single pair or many.
 */
export interface DriftPair {
  /** Absolute path to the committed artifact on disk. */
  path: string
  /** The freshly rendered content the committed file must byte-match. */
  rendered: string
}

export function assertNoDrift(pairs: DriftPair[], reRunHint: string): void {
  const rel = (p: string): string => relative(process.cwd(), p) || p
  const stale = pairs.filter((pair) => {
    const committed = existsSync(pair.path) ? readFileSync(pair.path, 'utf8') : null
    return committed !== pair.rendered
  })

  if (stale.length > 0) {
    for (const pair of stale) {
      process.stderr.write(`✗ ${rel(pair.path)} is STALE — run ${reRunHint}\n`)
    }
    process.exit(1)
  }

  process.stdout.write(`✓ ${pairs.map((p) => rel(p.path)).join(', ')} matches a fresh render\n`)
}

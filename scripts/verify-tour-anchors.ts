import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * `pnpm tour:verify`: the code-tour anchor gate. docs/code-tour.md pitches "file:line anchors you
 * can click"; this gate is what keeps that sentence true. The tour once drifted silently (anchors
 * pointed at the vote route while narrating create-post) because nothing verified them. For every
 * anchor of the form [`name.ts:N`](../path/to/name.ts#LN):
 *
 *   1. SAME LINE   the text line number and the #L fragment agree.
 *   2. RESOLVES    the relative path exists from docs/.
 *   3. IN RANGE    line N exists in the file and is not blank.
 *   4. SYMBOL      when the anchor is followed by (`Symbol`), that exact text appears on line N.
 *
 * Exits non-zero on any failure, so a moved source line cannot keep teaching the wrong code.
 */

const ROOT = process.cwd()
const TOUR = resolve(ROOT, 'docs/code-tour.md')

const ANCHOR = /\[`([^`\]]+?):(\d+)`\]\(([^)#\s]+)#L(\d+)\)(\s*\(`([^`]+)`\))?/g

interface Failure {
  anchor: string
  detail: string
}

function verify(): Failure[] {
  const tour = readFileSync(TOUR, 'utf8')
  const failures: Failure[] = []
  let count = 0
  for (const m of tour.matchAll(ANCHOR)) {
    count += 1
    const [, name, textLine, relPath, fragLine, , symbol] = m
    const anchor = `${name}:${textLine}`
    if (textLine !== fragLine) {
      failures.push({ anchor, detail: `text says :${textLine} but the link goes to #L${fragLine}` })
      continue
    }
    const target = resolve(dirname(TOUR), relPath)
    if (!existsSync(target)) {
      failures.push({ anchor, detail: `${relPath} does not resolve from docs/` })
      continue
    }
    const lines = readFileSync(target, 'utf8').split('\n')
    const n = Number(textLine)
    const line = lines[n - 1]
    if (n < 1 || n > lines.length || line === undefined) {
      failures.push({
        anchor,
        detail: `${relPath} has ${lines.length} lines; :${n} is out of range`,
      })
      continue
    }
    if (line.trim() === '') {
      failures.push({ anchor, detail: `${relPath}:${n} is a blank line: the anchor has drifted` })
      continue
    }
    if (symbol && !line.includes(symbol)) {
      failures.push({
        anchor,
        detail: `\`${symbol}\` is not on ${relPath}:${n} (got: ${line.trim().slice(0, 80)})`,
      })
    }
  }
  if (count === 0) {
    failures.push({
      anchor: '(none)',
      detail: 'no [`file:line`](path#L) anchors found in docs/code-tour.md: format drift?',
    })
  }
  process.stdout.write(`tour:verify: ${count} anchors checked\n`)
  return failures
}

function main(): void {
  const failures = verify()
  if (failures.length > 0) {
    for (const f of failures) process.stderr.write(`  ✗ ${f.anchor}: ${f.detail}\n`)
    process.stderr.write(
      `\ntour:verify FAILED: ${failures.length} drifted anchor(s) in docs/code-tour.md\n`,
    )
    process.exit(1)
  }
  process.stdout.write(`tour:verify ✓: every cited line still says what the tour says it says\n`)
}

main()

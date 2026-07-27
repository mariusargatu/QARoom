import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * A `pnpm --filter` runner that FAILS when nothing ran.
 *
 * Measured on pnpm 10.17.1: `pnpm --filter <pkg> <script>` exits **0** both when the filter
 * matches no project and when no selected package declares the script. Every drift gate in this
 * repo is shaped read-before / shell-out / read-after, so a silent no-op is indistinguishable
 * from "the committed artifact already matched its source" — it prints a green checkmark having
 * regenerated nothing. Rename a package and that service leaves the gate while CI reports it
 * verified. This module makes the no-op loud.
 */
const ROOT = process.cwd()
const SERVICES_DIR = resolve(ROOT, 'services')

/**
 * pnpm's two "I did nothing" messages, mapped to the reason a caller should report. Matched as
 * substrings because pnpm interpolates the repo root / script name into them.
 */
const NO_OP_MARKERS: ReadonlyArray<readonly [marker: string, reason: string]> = [
  ['No projects matched the filters', 'the --filter matched no workspace package'],
  ['None of the selected packages has a', 'the matched package(s) declare no such script'],
]

/** Why this pnpm invocation ran nothing, or `null` if it really ran something. */
export function noOpReason(output: string): string | null {
  return NO_OP_MARKERS.find(([marker]) => output.includes(marker))?.[1] ?? null
}

/**
 * Every `services/<name>` whose package.json declares `script`, read from disk. Drift gates use
 * this to cross-check their hand-written service list: a service that silently stopped declaring
 * the generator shows up as a set difference instead of as a green no-op.
 */
export function servicesDeclaringScript(script: string): string[] {
  return readdirSync(SERVICES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => {
      const manifest = resolve(SERVICES_DIR, name, 'package.json')
      if (!existsSync(manifest)) return false
      const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { scripts?: Record<string, string> }
      return typeof pkg.scripts?.[script] === 'string'
    })
}

/**
 * Run `pnpm --filter <pkg> <script>` and THROW if pnpm reported that nothing ran. Output is
 * captured rather than inherited so the markers are inspectable; it is re-emitted on stdout so
 * the gate logs read the same as before.
 */
export function runWorkspaceScript(pkg: string, script: string): void {
  const output = execFileSync('pnpm', ['--filter', pkg, script], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const reason = noOpReason(output)
  if (reason !== null) {
    throw new Error(
      `\`pnpm --filter ${pkg} ${script}\` ran nothing — ${reason}. pnpm exits 0 here, so the ` +
        `gate would have passed without regenerating anything. Fix the filter or the script name.`,
    )
  }
  process.stdout.write(output)
}

/**
 * Assert a drift gate's hand-written service list still matches what the workspace declares.
 * Throws naming both directions of the difference: a service that declares the generator but is
 * ungated ships spec drift unnoticed, and a gated service that no longer declares it is the
 * rename case that used to pass green having regenerated nothing.
 *
 * `exempt` maps a service to WHY it is deliberately outside this gate — a reason string, not a
 * bare allowlist, matching `scripts/census.ts`'s allowlisted-with-reason precedent. The only
 * current entry is moderator-agent, whose specs are drift-checked by pytest in the nightly Python
 * lane because this in-process gate has no `uv`.
 */
export function assertServiceListCoversWorkspace(
  declared: readonly string[],
  script: string,
  exempt: Readonly<Record<string, string>> = {},
): void {
  const onDisk = servicesDeclaringScript(script)
  const missing = onDisk.filter((svc) => !declared.includes(svc) && exempt[svc] === undefined)
  const stale = declared.filter((svc) => !onDisk.includes(svc))
  if (missing.length === 0 && stale.length === 0) return
  throw new Error(
    `drift-gate service list is out of sync with the workspace for "${script}": ` +
      `${missing.length} declaring it but ungated [${missing.join(', ')}], ` +
      `${stale.length} gated but no longer declaring it [${stale.join(', ')}]. ` +
      `Add the service to the gate, or exempt it with a reason.`,
  )
}

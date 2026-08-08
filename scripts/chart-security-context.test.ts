import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

/**
 * Both halves of "the hardened chart must still be able to start".
 *
 * `8162caa` (2026-07-12) hardened the shared securityContext and broke every workload in the chart
 * in one commit, two different ways:
 *
 *   Postgres      `capabilities.drop: ["ALL"]` strips CHOWN/SETUID/SETGID, which the upstream image's
 *                 entrypoint needs to chown PGDATA and `gosu` to the postgres user. It dies on its
 *                 first line with `chown: … Operation not permitted`.
 *   Node services `runAsUser: 10001` is a UID with no /etc/passwd entry, so HOME falls back to `/`,
 *                 which only root can write. corepack — the first thing every `pnpm …` entrypoint
 *                 runs — dies on `EACCES: mkdir '/.cache/node/corepack/v1'`.
 *
 * Every pod in the namespace CrashLoopBackOffed and `pnpm dev` was unusable for weeks. Neither
 * `helm lint` nor `kubeconform` can see either failure: a securityContext that cannot boot is still
 * perfectly valid YAML, so both structure gates stayed green. The cluster lanes that WOULD have
 * caught it (`cluster-smoke`, `tracetest`, `chaos`) live in the activity-gated nightly integration
 * tier, which had not run since 2026-07-28 — where `cluster-smoke` did fail, unread.
 *
 * These assertions are cheap, run on the PR lane, and each names the runtime failure it prevents.
 * The behavioural counterpart — actually booting what the chart renders, plus a negative control
 * proving the grant is load-bearing — is `scripts/chart-postgres-boot.ts` in the `chart` lane.
 *
 * Runs in `pnpm test:scripts`, which `ci.yml`'s required `verify` job executes on every PR.
 */

const ROOT = process.cwd()
const HELPERS = 'packages/helm-template/templates/_helpers.tpl'
const STATEFULSET = 'packages/helm-template/templates/postgres-statefulset.yaml'
const DEPLOYMENT = 'packages/helm-template/templates/deployment.yaml'
const CONTAINER_HELPER = 'qaroom-service.containerSecurityContext'
const HELPER_NAME = 'qaroom-service.postgresSecurityContext'

/**
 * Capabilities the upstream entrypoint cannot start without. Determined by leave-one-out over
 * `docker run --cap-drop ALL --cap-add … postgres:18-alpine` across BOTH lifecycle phases — first
 * boot on an empty volume, and a RESTART against a PGDATA already owned by the postgres user.
 *
 * The two phases disagree, which is the trap: on a fresh volume CHOWN+SETGID+SETUID suffice and the
 * pods come up green, but on restart root can no longer traverse a directory it does not own and
 * needs DAC_OVERRIDE. A single-phase derivation therefore ships a cluster that works exactly once.
 * FOWNER is genuinely not required in either phase. Least privilege is the point: this list is a
 * floor to keep Postgres alive, not a licence to widen it.
 */
const REQUIRED_CAPABILITIES = ['CHOWN', 'DAC_OVERRIDE', 'SETGID', 'SETUID'] as const

/**
 * The helper's body is plain YAML — no Go-template expressions — so it can be parsed and asserted
 * on as a structure rather than string-matched. Extracting it by name also means a rename of the
 * define fails this gate loudly instead of silently matching nothing.
 */
function postgresSecurityContext(): Record<string, unknown> {
  const source = readFileSync(resolve(ROOT, HELPERS), 'utf8')
  // HELPER_NAME contains dots, which are RegExp wildcards — escaped, or the pattern would also match
  // a similarly-shaped name. Both delimiters tolerate the whitespace-trim variants Go templates
  // allow ({{- end -}}, {{ end }}, {{- end }}), so a reformat of the chart cannot silently make this
  // extraction find nothing and the assertions below vacuous.
  const escaped = HELPER_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const open = new RegExp(`\\{\\{-?\\s*define\\s+"${escaped}"\\s*-?\\}\\}`)
  const opened = source.match(open)
  expect(opened, `${HELPERS} defines no "${HELPER_NAME}" helper`).not.toBeNull()

  const bodyStart = (opened?.index ?? 0) + (opened?.[0].length ?? 0)
  const closing = source.slice(bodyStart).match(/\{\{-?\s*end\s*-?\}\}/)
  expect(closing, `"${HELPER_NAME}" has no closing {{ end }}`).not.toBeNull()

  return parse(source.slice(bodyStart, bodyStart + (closing?.index ?? 0))) as Record<
    string,
    unknown
  >
}

const capabilities = (): { drop?: string[]; add?: string[] } =>
  (postgresSecurityContext().capabilities ?? {}) as { drop?: string[]; add?: string[] }

describe('the shared chart’s Postgres securityContext', () => {
  it.each(
    REQUIRED_CAPABILITIES,
  )('grants %s, without which the postgres entrypoint cannot start', (capability) => {
    expect(capabilities().add ?? []).toContain(capability)
  })

  it('still drops every capability by default, so the grant stays an allow-list', () => {
    expect(capabilities().drop).toEqual(['ALL'])
  })

  it('grants no capability beyond the four the entrypoint provably needs', () => {
    expect([...(capabilities().add ?? [])].sort()).toEqual([...REQUIRED_CAPABILITIES].sort())
  })

  it('keeps privilege escalation off despite the added capabilities', () => {
    expect(postgresSecurityContext().allowPrivilegeEscalation).toBe(false)
  })

  it('is the securityContext the postgres statefulset actually applies', () => {
    // A correct helper nothing references would leave the pods just as dead.
    expect(readFileSync(resolve(ROOT, STATEFULSET), 'utf8')).toContain(HELPER_NAME)
  })

  it('grants those capabilities to the postgres statefulset ALONE', () => {
    // The whole justification for re-adding capabilities is that they are scoped to one upstream
    // image with a known entrypoint. If another template starts including this helper, the grant
    // silently widens to a workload nobody derived it for — so pin the reference set, not just the
    // presence of one reference.
    const users = globSync('packages/helm-template/templates/*.yaml', { cwd: ROOT })
      .filter((file) => readFileSync(resolve(ROOT, file), 'utf8').includes(HELPER_NAME))
      .sort()
    expect(users).toEqual([STATEFULSET])
  })
})

/**
 * Every template that runs a Node container as the chart's home-less UID, discovered rather than
 * listed: any template including `containerSecurityContext` inherits `runAsUser: 10001`. Globbing
 * is the point — the Deployment and the gc-dedup CronJob broke identically, and the CronJob's
 * failure was invisible for weeks because a CronJob that dies raises nothing. A future template
 * added with the same omission is caught here without anyone remembering to extend this test.
 */
function nodeWorkloadTemplates(): string[] {
  return globSync('packages/helm-template/templates/*.yaml', { cwd: ROOT })
    .filter((file) => readFileSync(resolve(ROOT, file), 'utf8').includes(CONTAINER_HELPER))
    .sort()
}

describe('the shared chart’s Node containers', () => {
  const templates = nodeWorkloadTemplates()

  it('finds the workload templates to check (not a vacuously empty glob)', () => {
    expect(templates).toContain(DEPLOYMENT)
    expect(templates.length).toBeGreaterThanOrEqual(2)
  })

  it.each(templates)('%s gives the home-less UID a writable HOME', (file) => {
    // runAsUser: 10001 has no /etc/passwd entry, so HOME falls back to `/` — root-owned. The
    // `pnpm …` entrypoint shells corepack first, which dies on
    // `EACCES: mkdir '/.cache/node/corepack/v1'` before any application code loads.
    const home = readFileSync(resolve(ROOT, file), 'utf8').match(
      /- name: HOME\s*\n\s*value:\s*(\S+)/,
    )
    expect(home?.[1], `${file} runs a Node container but sets no HOME`).toBeDefined()
    expect(['/tmp', '"/tmp"']).toContain(home?.[1])
  })

  it('keeps the root filesystem writable, so the HOME it is given can be created', () => {
    // A later `readOnlyRootFilesystem: true` would reintroduce the same crash by another route:
    // /tmp would no longer be writable and corepack would fail again. Pairing the two assertions
    // makes that trade-off explicit rather than a surprise at deploy time.
    const helpers = readFileSync(resolve(ROOT, HELPERS), 'utf8')
    expect(helpers).toContain('readOnlyRootFilesystem: false')
  })
})

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { asyncapiBreakingChanges } from '@qaroom/testing-utils/async-diff'
import { parse } from 'yaml'
import { isDeclared, staleAllowances } from './lib/manifests/breaking-allowances'

/**
 * The breaking-change gate for THIS repo's contracts.
 *
 * `openapi-verify.ts` and `asyncapi-verify.ts` each prove their classifier works by diffing two
 * synthetic fixtures (a `/widgets` + `/gadgets` API that exists nowhere in QARoom). That is a
 * tool health check, not a gate: remove a required response field from a real service, run
 * `openapi:generate`, commit both, and the drift half passes (you regenerated) while the
 * breaking half passes (the fixtures did not move). Every consumer breaks, green.
 *
 * This diffs each service's COMMITTED spec against its state at a base ref, so a breaking change
 * to a real contract is reported against the change that introduced it. AGENTS.md's merge bar
 * says "no UNDECLARED breaking changes"; `lib/manifests/breaking-allowances.ts` is the declared
 * half, which previously did not exist.
 *
 *   pnpm contract:breaking                 # vs merge-base with origin/main
 *   CONTRACT_BASE_SHA=<sha> pnpm contract:breaking
 */
const ROOT = process.cwd()
const OPENAPI_SERVICES = ['content', 'identity', 'gateway', 'flags', 'donations', 'webhooks']
const ASYNCAPI_SERVICES = ['content', 'flags', 'donations', 'gateway', 'webhooks']

interface Reported {
  service: string
  spec: 'openapi' | 'asyncapi'
  path: string
  reason: string
}

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
}

/** The ref to diff against: an explicit base (CI passes the PR base), else merge-base with main. */
function baseRef(): string {
  const explicit = process.env.CONTRACT_BASE_SHA
  if (explicit !== undefined && explicit.length > 0) return explicit
  for (const main of ['origin/main', 'main']) {
    try {
      return git(['merge-base', 'HEAD', main])
    } catch {
      /* try the next candidate */
    }
  }
  return git(['rev-parse', 'HEAD'])
}

/** A spec's contents at `ref`, or null when it did not exist there (a new service). */
function specAtRef(ref: string, path: string): string | null {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], { cwd: ROOT, encoding: 'utf8' })
  } catch {
    return null
  }
}

const base = baseRef()
const head = git(['rev-parse', 'HEAD'])

/**
 * Refuse to run against a base commit that is not in this clone. `actions/checkout` defaults to
 * `fetch-depth: 1`, so on a shallow clone every `git show <base>:<spec>` fails, every spec looks
 * absent, and the gate reports "no breaking changes" having compared nothing. That is the exact
 * vacuous pass this gate exists to remove, so it is a hard error rather than a skip.
 */
try {
  execFileSync('git', ['cat-file', '-e', `${base}^{commit}`], { cwd: ROOT, stdio: 'ignore' })
} catch {
  process.stderr.write(
    `contract breaking-change gate: base commit ${base.slice(0, 8)} is not present in this clone ` +
      '(a shallow checkout?). The gate would compare nothing and pass vacuously. Use ' +
      'actions/checkout with fetch-depth: 0, or set CONTRACT_BASE_SHA to a commit you have.\n',
  )
  process.exit(2)
}

process.stdout.write(`contract breaking-change gate: diffing against ${base.slice(0, 8)}\n`)

const reported: Reported[] = []

for (const svc of ASYNCAPI_SERVICES) {
  const rel = `services/${svc}/asyncapi.yaml`
  const abs = resolve(ROOT, rel)
  if (!existsSync(abs)) continue
  const before = specAtRef(base, rel)
  if (before === null) continue
  const baseDoc = parse(before) as Record<string, unknown>
  const headDoc = parse(readFileSync(abs, 'utf8')) as Record<string, unknown>
  for (const change of asyncapiBreakingChanges(baseDoc, headDoc)) {
    reported.push({ service: svc, spec: 'asyncapi', path: change.path, reason: change.reason })
  }
}

/**
 * oasdiff is a Go binary we run via Docker. Absence is tolerated locally (the AsyncAPI half above
 * still gates) but NEVER in CI: a gate that silently skips itself on the one machine that matters
 * is the failure mode this whole change exists to remove.
 */
function hasDocker(): boolean {
  try {
    execFileSync('docker', ['version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const dockerAvailable = hasDocker()
if (!dockerAvailable && process.env.CI === 'true') {
  process.stderr.write(
    'contract breaking-change gate: Docker is unavailable but CI=true — the OpenAPI half cannot ' +
      'be skipped on the lane that gates merges.\n',
  )
  process.exit(1)
}

if (dockerAvailable) {
  const tmp = resolve(ROOT, 'test-results/contract-breaking')
  execFileSync('mkdir', ['-p', tmp])
  for (const svc of OPENAPI_SERVICES) {
    const rel = `services/${svc}/openapi.yaml`
    const before = specAtRef(base, rel)
    if (before === null) continue
    const basePath = resolve(tmp, `${svc}.base.yaml`)
    execFileSync('cp', [resolve(ROOT, rel), resolve(tmp, `${svc}.head.yaml`)])
    execFileSync('sh', ['-c', `cat > ${JSON.stringify(basePath)}`], { input: before })
    try {
      execFileSync(
        'docker',
        [
          'run',
          '--rm',
          '-v',
          `${tmp}:/specs:ro`,
          'tufin/oasdiff:latest',
          'breaking',
          `/specs/${svc}.base.yaml`,
          `/specs/${svc}.head.yaml`,
          '--fail-on',
          'ERR',
        ],
        { stdio: 'pipe' },
      )
    } catch (error) {
      const out = String((error as { stdout?: Buffer }).stdout ?? '')
      reported.push({
        service: svc,
        spec: 'openapi',
        path: `services/${svc}/openapi.yaml`,
        reason: out.split('\n').filter(Boolean).slice(0, 6).join(' | ') || 'oasdiff reported ERR',
      })
    }
  }
} else {
  process.stdout.write(
    '  openapi half SKIPPED (no Docker; runs in CI where Docker is present)\n',
  )
}

const undeclared = reported.filter((r) => !isDeclared(r.service, r.spec, r.path))
const stale = staleAllowances(reported)

for (const r of undeclared) {
  process.stderr.write(`✗ breaking (${r.service} ${r.spec}) ${r.path}\n    ${r.reason}\n`)
}
for (const a of stale) {
  process.stderr.write(
    `✗ stale allowance (${a.service} ${a.spec}) ${a.path} — no such change is reported; remove it\n`,
  )
}

if (undeclared.length > 0 || stale.length > 0) {
  process.stderr.write(
    `\n${undeclared.length} undeclared breaking change(s), ${stale.length} stale allowance(s). ` +
      'Either revise the contract, or declare the break with a reason in ' +
      'scripts/lib/manifests/breaking-allowances.ts.\n',
  )
  process.exit(1)
}

const scope = base === head ? 'no commits to diff' : `${reported.length} declared`
process.stdout.write(
  `contract breaking-change gate: no undeclared breaking changes (${scope}) ✓\n`,
)

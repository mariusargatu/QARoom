import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ServiceSnapshot,
  SNAPSHOT_SCHEMA_VERSION,
  SnapshotBundleV1,
  type SnapshotManifestEntry,
} from '@qaroom/contracts'

/**
 * qaroom-replay (Commitment 8, Milestone 7): capture per-service snapshots into a versioned
 * tarball bundle, and load a bundle into a (replay-mode) environment by POSTing each snapshot.
 *
 *   pnpm replay:capture <scenario> [--chaos <slug>...]  # snapshots (+ chaos manifests) -> bundle
 *   pnpm replay:load <scenario> [--chaos]               # POST snapshots (+ reapply the chaos)
 *
 * Capture reads from the LIVE service (CONTENT_SNAPSHOT_URL); load writes to the REPLAY service
 * (CONTENT_REPLAY_URL), which is booted with SNAPSHOT_REPLAY + the bundle's clock_seed. Bringing
 * up the Docker Compose replay env + booting the service in replay mode is the caller's step
 * (see docs/failure-modes.md / the regression test); this CLI owns the bundle + the HTTP transfer.
 *
 * Chaos capture/reapply (the seam Commitment 6 promised but never wired — `chaos_manifests` was
 * hardcoded []): `capture --chaos <slug>` copies `chaos-experiments/<slug>.yaml` INTO the bundle,
 * so "a chaos run is replayable from the bundle alone" becomes literally true; `load --chaos`
 * kubectl-applies each bundled manifest after the snapshots land. Healing is the CALLER's job
 * (scripts/replay-under-chaos.sh owns the trap) — the loader's contract is to recreate the
 * captured conditions, not to decide when they end. In-cluster targets keep the production clock
 * (POST /system/snapshot restore is unguarded, ADR-0009) — fine for chaos/latency/trace-shape
 * assertions; clock-sensitive scenarios stay on the compose replay path.
 */
const ROOT = process.cwd()
const SCENARIOS = resolve(ROOT, 'scenarios')

interface ServiceConfig {
  name: string
  captureUrl: string
  replayUrl: string
}

const SERVICES: ServiceConfig[] = [
  {
    name: 'content',
    captureUrl: process.env.CONTENT_SNAPSHOT_URL ?? 'http://localhost:18081',
    replayUrl: process.env.CONTENT_REPLAY_URL ?? 'http://localhost:18091',
  },
  {
    name: 'identity',
    captureUrl: process.env.IDENTITY_SNAPSHOT_URL ?? 'http://localhost:18082',
    replayUrl: process.env.IDENTITY_REPLAY_URL ?? 'http://localhost:18092',
  },
  {
    name: 'flags',
    captureUrl: process.env.FLAGS_SNAPSHOT_URL ?? 'http://localhost:18083',
    replayUrl: process.env.FLAGS_REPLAY_URL ?? 'http://localhost:18093',
  },
  {
    name: 'donations',
    captureUrl: process.env.DONATIONS_SNAPSHOT_URL ?? 'http://localhost:18084',
    replayUrl: process.env.DONATIONS_REPLAY_URL ?? 'http://localhost:18094',
  },
]

async function captureOne(svc: ServiceConfig, dir: string): Promise<SnapshotManifestEntry | null> {
  // Skip a service that isn't running (connection refused) so a partial bundle still captures;
  // a service that IS up but errors on the endpoint is a real failure and throws.
  const res = await fetch(`${svc.captureUrl}/system/snapshot`).catch(() => null)
  if (res === null) {
    process.stdout.write(`  skip ${svc.name}: not reachable at ${svc.captureUrl}\n`)
    return null
  }
  if (!res.ok) throw new Error(`capture ${svc.name}: GET /system/snapshot -> ${res.status}`)
  const snapshot = ServiceSnapshot.parse(await res.json())
  const snapshotFile = `${svc.name}.snapshot.json`
  writeFileSync(resolve(dir, snapshotFile), `${JSON.stringify(snapshot, null, 2)}\n`)
  return {
    name: svc.name,
    snapshot_file: snapshotFile,
    lamport: snapshot.lamport,
    clock_seed: snapshot.clock_seed,
  }
}

async function capture(name: string, chaosSlugs: string[]): Promise<void> {
  const dir = resolve(SCENARIOS, name)
  // Start clean: a prior partial/failed capture can leave per-service snapshot files behind, and
  // `tar -C dir .` would pack them into the bundle even though the manifest doesn't list them.
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  // Chaos manifests travel INSIDE the bundle (copied, not referenced) so the scenario replays
  // from the tarball alone even if the repo's experiment file later changes.
  const chaosManifests = chaosSlugs.map((slug) => {
    const src = resolve(ROOT, 'chaos-experiments', `${slug}.yaml`)
    if (!existsSync(src)) throw new Error(`no chaos experiment at chaos-experiments/${slug}.yaml`)
    mkdirSync(resolve(dir, 'chaos'), { recursive: true })
    copyFileSync(src, resolve(dir, 'chaos', `${slug}.yaml`))
    return `chaos/${slug}.yaml`
  })

  // Capture every service concurrently — independent GETs to independent services (map preserves
  // SERVICES order, so the manifest is stable); unreachable services drop out via the null filter.
  const captured = await Promise.all(SERVICES.map((svc) => captureOne(svc, dir)))
  const services = captured.filter((entry): entry is SnapshotManifestEntry => entry !== null)

  const manifest = SnapshotBundleV1.parse({
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    created_at: new Date().toISOString(),
    services,
    chaos_manifests: chaosManifests,
  })
  writeFileSync(resolve(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  execFileSync('tar', ['-czf', resolve(SCENARIOS, `${name}.tar.gz`), '-C', dir, '.'])
  process.stdout.write(
    `captured "${name}" -> scenarios/${name}.tar.gz (${services.length} service(s); ` +
      `lamport ${services.map((s) => `${s.name}=${s.lamport}`).join(', ')})\n`,
  )
}

/** Apply one bundled chaos manifest and wait for the operator to accept it (desiredPhase=Run). */
function applyChaos(path: string): void {
  execFileSync('kubectl', ['apply', '-f', path], { stdio: 'inherit' })
  for (let i = 0; i < 30; i += 1) {
    const phase = execFileSync(
      'kubectl',
      ['get', '-f', path, '-o', 'jsonpath={.status.experiment.desiredPhase}'],
      { encoding: 'utf8' },
    ).trim()
    if (phase === 'Run') {
      process.stdout.write(`chaos active: ${path} (desiredPhase=Run)\n`)
      return
    }
    execFileSync('sleep', ['1'])
  }
  throw new Error(
    `chaos manifest ${path} never reached desiredPhase=Run — is Chaos Mesh installed?`,
  )
}

async function load(name: string, reapplyChaos: boolean): Promise<void> {
  const dir = resolve(SCENARIOS, name)
  if (!existsSync(resolve(dir, 'manifest.json'))) {
    mkdirSync(dir, { recursive: true })
    execFileSync('tar', ['-xzf', resolve(SCENARIOS, `${name}.tar.gz`), '-C', dir])
  }
  const manifest = SnapshotBundleV1.parse(
    JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')),
  )
  const targets = new Map(SERVICES.map((s) => [s.name, s.replayUrl]))

  async function loadOne(entry: SnapshotManifestEntry): Promise<void> {
    const target = targets.get(entry.name)
    if (!target) throw new Error(`no replay target configured for service "${entry.name}"`)
    const body = readFileSync(resolve(dir, entry.snapshot_file), 'utf8')
    const res = await fetch(`${target}/system/snapshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    if (!res.ok) throw new Error(`load ${entry.name}: POST /system/snapshot -> ${res.status}`)
    process.stdout.write(
      `loaded ${entry.name} (lamport ${entry.lamport}, clock_seed ${entry.clock_seed}) -> ${target}\n`,
    )
  }

  // Load every snapshot concurrently — each targets its own service's isolated DB (no ordering).
  await Promise.all(manifest.services.map(loadOne))

  if (reapplyChaos && manifest.chaos_manifests.length > 0) {
    // State first, THEN the fault — the captured conditions are "this state under this chaos",
    // and applying chaos before the snapshots would perturb the load itself.
    for (const rel of manifest.chaos_manifests) applyChaos(resolve(dir, rel))
    process.stdout.write(
      `chaos reapplied (${manifest.chaos_manifests.length} manifest(s)) — the CALLER owns healing ` +
        `(scripts/replay-under-chaos.sh traps it).\n`,
    )
  } else if (manifest.chaos_manifests.length > 0) {
    process.stdout.write(
      `bundle carries ${manifest.chaos_manifests.length} chaos manifest(s) — NOT applied (pass --chaos to reapply)\n`,
    )
  }
  process.stdout.write(
    `replay env loaded from "${name}". Boot each service with SNAPSHOT_REPLAY=1 + ` +
      `SNAPSHOT_CLOCK_SEED=<clock_seed> so time is pinned.\n`,
  )
}

const [command, scenario, ...rest] = process.argv.slice(2)
if (!command || !scenario || (command !== 'capture' && command !== 'load')) {
  process.stderr.write(
    'usage: qaroom-replay capture <scenario> [--chaos <slug>...] | load <scenario> [--chaos]\n',
  )
  process.exit(2)
}
const chaosFlagIdx = rest.indexOf('--chaos')
const chaosSlugs = chaosFlagIdx >= 0 ? rest.slice(chaosFlagIdx + 1) : []
if (command === 'capture' && chaosFlagIdx >= 0 && chaosSlugs.length === 0) {
  process.stderr.write('capture --chaos needs at least one experiment slug\n')
  process.exit(2)
}
// Validate the scenario name before it reaches `resolve(SCENARIOS, name)` + `rmSync`: a name with a
// path separator or `..` would escape the scenarios dir, and capture's `rmSync` would then delete an
// arbitrary tree (e.g. `capture ..` → the repo root). Restrict to a single safe path segment.
if (!/^[A-Za-z0-9._-]+$/.test(scenario) || scenario === '.' || scenario === '..') {
  process.stderr.write(
    `invalid scenario name "${scenario}": use only letters, digits, '.', '-', '_' (no path separators)\n`,
  )
  process.exit(2)
}

const run =
  command === 'capture' ? capture(scenario, chaosSlugs) : load(scenario, chaosFlagIdx >= 0)
run.catch((err: unknown) => {
  process.stderr.write(`qaroom-replay ${command} failed: ${String(err)}\n`)
  process.exit(1)
})

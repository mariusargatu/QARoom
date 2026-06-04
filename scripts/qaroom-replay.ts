import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
 *   pnpm replay:capture <scenario>   # GET /system/snapshot from each live service -> bundle
 *   pnpm replay:load <scenario>      # POST each snapshot into the replay targets
 *
 * Capture reads from the LIVE service (CONTENT_SNAPSHOT_URL); load writes to the REPLAY service
 * (CONTENT_REPLAY_URL), which is booted with SNAPSHOT_REPLAY + the bundle's clock_seed. Bringing
 * up the Docker Compose replay env + booting the service in replay mode is the caller's step
 * (see docs/failure-modes.md / the regression test); this CLI owns the bundle + the HTTP transfer.
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

async function capture(name: string): Promise<void> {
  const dir = resolve(SCENARIOS, name)
  // Start clean: a prior partial/failed capture can leave per-service snapshot files behind, and
  // `tar -C dir .` would pack them into the bundle even though the manifest doesn't list them.
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  // Capture every service concurrently — independent GETs to independent services (map preserves
  // SERVICES order, so the manifest is stable); unreachable services drop out via the null filter.
  const captured = await Promise.all(SERVICES.map((svc) => captureOne(svc, dir)))
  const services = captured.filter((entry): entry is SnapshotManifestEntry => entry !== null)

  const manifest = SnapshotBundleV1.parse({
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    created_at: new Date().toISOString(),
    services,
    chaos_manifests: [],
  })
  writeFileSync(resolve(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  execFileSync('tar', ['-czf', resolve(SCENARIOS, `${name}.tar.gz`), '-C', dir, '.'])
  process.stdout.write(
    `captured "${name}" -> scenarios/${name}.tar.gz (${services.length} service(s); ` +
      `lamport ${services.map((s) => `${s.name}=${s.lamport}`).join(', ')})\n`,
  )
}

async function load(name: string): Promise<void> {
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
  process.stdout.write(
    `replay env loaded from "${name}". Boot each service with SNAPSHOT_REPLAY=1 + ` +
      `SNAPSHOT_CLOCK_SEED=<clock_seed> so time is pinned.\n`,
  )
}

const [command, scenario] = process.argv.slice(2)
if (!command || !scenario || (command !== 'capture' && command !== 'load')) {
  process.stderr.write('usage: qaroom-replay <capture|load> <scenario-name>\n')
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

const run = command === 'capture' ? capture(scenario) : load(scenario)
run.catch((err: unknown) => {
  process.stderr.write(`qaroom-replay ${command} failed: ${String(err)}\n`)
  process.exit(1)
})

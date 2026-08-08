import { execFileSync, spawnSync } from 'node:child_process'
import { parseAllDocuments } from 'yaml'

/**
 * The behavioural half of the Postgres securityContext gate: does a container running under the
 * securityContext the chart ACTUALLY RENDERS reach "ready to accept connections"?
 *
 * `helm lint` and `kubeconform` answer a different question — is the YAML well formed — and both
 * stayed green through `8162caa`, which set the Postgres container to a bare
 * `capabilities.drop: ["ALL"]` and CrashLoopBackOffed every `*-pg-0` pod in the cluster. A
 * securityContext that cannot boot is perfectly valid YAML. Structure gates cannot see it; only
 * starting the thing can.
 *
 * Three assertions, and the last two are what make the first mean something:
 *
 *   FIRST BOOT  the rendered securityContext boots Postgres on an empty volume.
 *   RESTART     it boots AGAIN against the PGDATA that first boot left behind.
 *   NEGATIVE    stripping the added capabilities must FAIL to boot.
 *
 * The restart phase is not ceremony. The two phases genuinely disagree: on a fresh volume
 * CHOWN+SETGID+SETUID are enough, so a first-boot-only check goes green and the cluster comes up —
 * then dies on its first restart, because root without DAC_OVERRIDE cannot traverse a data directory
 * now owned by the postgres user. That is precisely how this repo's capability set was first derived
 * WRONG, and only a restart caught it.
 *
 * Without the negative control this script would also pass if Docker silently ignored capabilities,
 * or if the image stopped needing them — a green that proves nothing. It mirrors the `cluster-smoke`
 * lane's existing "a broken service.targetPort must fail the smoke" control.
 *
 * Needs Docker + Helm, so it runs in the nightly `chart` lane, not the in-process `verify` job. The
 * capability LIST is pinned separately and on every PR by
 * scripts/chart-security-context.test.ts.
 *
 *   pnpm chart:postgres-boot
 */
const SERVICE = process.env.CHART_BOOT_SERVICE ?? 'content'
const READY = 'ready to accept connections'
/** Generous: covers the image pull plus initdb on a cold CI runner. */
const BOOT_TIMEOUT_MS = 120_000

interface ContainerSecurity {
  image: string
  capabilities: { drop?: string[]; add?: string[] }
}

function fail(message: string): never {
  process.stderr.write(`✗ ${message}\n`)
  process.exit(1)
}

/** The Postgres container exactly as Helm renders it for a real service's values. */
function renderedPostgresContainer(): ContainerSecurity {
  const rendered = execFileSync(
    'helm',
    ['template', SERVICE, 'packages/helm-template', '-f', `deploy/${SERVICE}/values.yaml`],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )

  for (const doc of parseAllDocuments(rendered)) {
    const value = doc.toJS() as Record<string, unknown> | null
    if (value?.kind !== 'StatefulSet') continue
    const spec = value.spec as { template?: { spec?: { containers?: Record<string, unknown>[] } } }
    const container = spec?.template?.spec?.containers?.find((c) => c.name === 'postgres')
    if (!container) continue
    const security = container.securityContext as {
      capabilities?: ContainerSecurity['capabilities']
    }
    // Helm renders `image` as a scalar, but values files express it as {repository, tag}. If a
    // future template interpolates the map instead, `String(...)` would yield "[object Object]" and
    // this gate would docker-run a nonsense image name — failing for the wrong reason, or worse
    // passing something meaningless. Name it instead.
    if (typeof container.image !== 'string') {
      return fail(
        `rendered postgres image is ${typeof container.image}, not a string — the chart is ` +
          `interpolating an object (probably {repository, tag}); build the reference explicitly`,
      )
    }
    return { image: container.image, capabilities: security?.capabilities ?? {} }
  }
  return fail(`no postgres container in the rendered chart for '${SERVICE}'`)
}

/**
 * Boot Postgres under a capability set and report whether it came up. Returns the readiness verdict
 * rather than throwing, because the negative control needs the FAILING case to be an ordinary
 * result — a control that crashes the script is not a control.
 */
function booted(
  image: string,
  drop: string[],
  add: string[],
  volume: string,
): { ready: boolean; output: string } {
  const name = `qaroom-pg-boot-${process.pid}-${add.length}-${volume.slice(-6)}`
  const args = ['run', '--rm', '--name', name, '-v', `${volume}:/var/lib/postgresql/data`]
  for (const cap of drop) args.push('--cap-drop', cap)
  for (const cap of add) args.push('--cap-add', cap)
  args.push(
    '-e',
    'POSTGRES_USER=qaroom',
    '-e',
    'POSTGRES_PASSWORD=qaroom',
    '-e',
    'POSTGRES_DB=qaroom_boot',
    '-e',
    'PGDATA=/var/lib/postgresql/data/pgdata',
    image,
  )

  const run = spawnSync('docker', args, { encoding: 'utf8', timeout: BOOT_TIMEOUT_MS })
  // The server never exits on its own, so the timeout kill IS the success path: grep the log it
  // produced up to that point. A container that died early returns before the timeout.
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
  spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' })
  return { ready: output.includes(READY), output: output.trim().split('\n').slice(-4).join('\n') }
}

const { image, capabilities } = renderedPostgresContainer()
const drop = capabilities.drop ?? []
const add = capabilities.add ?? []
process.stdout.write(
  `chart renders ${SERVICE} postgres as ${image}\n  drop: [${drop.join(', ')}]  add: [${add.join(', ')}]\n\n`,
)

/** A named volume so the restart phase sees the data directory first boot created. */
function makeVolume(suffix: string): string {
  const name = `qaroom-pg-boot-${process.pid}-${suffix}`
  spawnSync('docker', ['volume', 'create', name], { stdio: 'ignore' })
  return name
}
function dropVolume(name: string): void {
  spawnSync('docker', ['volume', 'rm', '-f', name], { stdio: 'ignore' })
}

const liveVolume = makeVolume('live')
process.stdout.write(
  'FIRST BOOT — the rendered securityContext must start Postgres on a new volume\n',
)
const positive = booted(image, drop, add, liveVolume)
if (!positive.ready) {
  dropVolume(liveVolume)
  fail(
    `Postgres did NOT reach "${READY}" under the chart's own securityContext.\n` +
      `  drop: [${drop.join(', ')}]  add: [${add.join(', ')}]\n${positive.output}`,
  )
}
process.stdout.write(`  ✓ reached "${READY}"\n\n`)

process.stdout.write('RESTART — and again against the PGDATA it just created\n')
const restart = booted(image, drop, add, liveVolume)
dropVolume(liveVolume)
if (!restart.ready) {
  fail(
    `Postgres booted once but did NOT survive a RESTART. On the second boot PGDATA is owned by the\n` +
      `postgres user, so root needs DAC_OVERRIDE to reopen it. A first-boot-only capability set\n` +
      `produces a cluster that works exactly once.\n` +
      `  drop: [${drop.join(', ')}]  add: [${add.join(', ')}]\n${restart.output}`,
  )
}
process.stdout.write(`  ✓ reached "${READY}" on the second boot\n\n`)

process.stdout.write('NEGATIVE (control) — dropping the added capabilities must break it\n')
if (add.length === 0) {
  fail('the chart adds no capabilities, so the control cannot distinguish a real pass from a no-op')
}
const controlVolume = makeVolume('control')
const negative = booted(image, drop, [], controlVolume)
dropVolume(controlVolume)
if (negative.ready) {
  fail(
    `Postgres booted WITHOUT [${add.join(', ')}], so this gate proves nothing: it would stay green ` +
      `if the capabilities were removed again. Re-derive the minimal set and update ` +
      `scripts/chart-security-context.test.ts.`,
  )
}
process.stdout.write(`  ✓ failed to boot without [${add.join(', ')}], as required\n`)
process.stdout.write(
  '\n✓ chart postgres securityContext boots, and provably needs what it grants\n',
)

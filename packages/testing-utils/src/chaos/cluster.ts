import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { delay } from './timing'

const run = promisify(execFile)

/** Apply a committed chaos manifest (the replayable artifact, Commitment 6). */
export async function applyManifest(path: string): Promise<void> {
  try {
    await run('kubectl', ['apply', '-f', path])
  } catch (err) {
    // The cluster is built chaos-READY (bootstrap-k3d.sh allow-lists the sysctls), but the Chaos
    // Mesh operator is installed on-demand — by the gauntlet's phase-3 `chaos-install`, NOT by
    // `pnpm dev`. Running a chaos experiment against a cluster that skipped that step fails with a
    // raw `no matches for kind "…"`; rewrap it with the fix so the cause is legible, not cryptic.
    const detail = String((err as { stderr?: string }).stderr ?? err)
    if (/no matches for kind|ensure CRDs are installed/i.test(detail)) {
      throw new Error(
        `Chaos Mesh is not installed in this cluster — its CRDs are missing, so ${path} cannot be ` +
          `applied. Install the operator first: \`pnpm chaos:install\` (a full \`pnpm gauntlet\` does ` +
          `this in phase 3). Original error: ${detail}`,
      )
    }
    throw err
  }
}

/**
 * Remove a chaos manifest. Waits (bounded to 60s) for the fault to actually clear — experiments
 * run sequentially on one shared cluster, so returning before recovery would bleed a live fault
 * into the next experiment's baseline. The 60s `--timeout` bounds the pathological case (a
 * TimeChaos finalizer recovering a pool-poisoned pod can otherwise hang for minutes); on timeout
 * kubectl exits non-zero and we tolerate it (the controller finishes recovery async).
 */
export async function deleteManifest(path: string): Promise<void> {
  await run('kubectl', ['delete', '-f', path, '--ignore-not-found', '--timeout=60s']).catch(
    () => undefined,
  )
}

/**
 * Poll a Chaos Mesh experiment until its fault is actually injected (`desiredPhase=Run`).
 * Returning before injection would let the "during chaos" probe race the fault and flake.
 */
export async function waitForInjection(
  kind: string,
  name: string,
  namespace: string,
  attempts = 60,
): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    const phase = await run('kubectl', [
      '-n',
      namespace,
      'get',
      kind,
      name,
      '-o',
      'jsonpath={.status.experiment.desiredPhase}',
    ])
      .then((r) => r.stdout.trim())
      .catch(() => '')
    if (phase === 'Run') return
    await delay(1000)
  }
  throw new Error(`${kind}/${name} never reached desiredPhase=Run after ${attempts}s`)
}

/**
 * Wait for the pods matching `selector` to be Ready — used in a pod-recovery experiment's `heal`
 * so the after-chaos phase observes a healed service, not one mid-restart. Tolerant: a transient
 * "no resources" while the pod re-creates resolves on the next attempt within the timeout.
 */
export async function waitReady(
  namespace: string,
  selector: string,
  timeout = '120s',
): Promise<void> {
  await run('kubectl', [
    '-n',
    namespace,
    'wait',
    '--for=condition=ready',
    'pod',
    '-l',
    selector,
    `--timeout=${timeout}`,
  ]).catch(() => undefined)
}

/**
 * Force-remove a chaos CR even if its finalizer is stuck. NetworkChaos `partition` recovery on
 * k3d/flannel can hang the `chaos-mesh/records` finalizer (the daemon can't revert the iptables),
 * leaving the CR `Terminating` — which then blocks re-applying a same-named experiment on a
 * persistent cluster. Used to pre-clean any leftover before injecting, so repeated runs don't
 * wedge. (A fresh per-run cluster never hits this.)
 */
export async function forceDelete(kind: string, name: string, namespace: string): Promise<void> {
  await run('kubectl', [
    '-n',
    namespace,
    'delete',
    kind,
    name,
    '--ignore-not-found',
    '--wait=false',
  ]).catch(() => undefined)
  await run('kubectl', [
    '-n',
    namespace,
    'patch',
    kind,
    name,
    '--type=merge',
    '-p',
    '{"metadata":{"finalizers":[]}}',
  ]).catch(() => undefined)
}

export interface PortForward {
  url: string
  stop: () => void
}

/**
 * `kubectl port-forward` to a Service, resolving once the local port answers `healthPath`.
 * Mirrors `scripts/smoke.sh` — the harness owns its own forward because Tilt's forwards stop
 * when `tilt ci` exits. Always `stop()` it in a test `finally`.
 */
export async function portForward(opts: {
  namespace: string
  target: string
  localPort: number
  remotePort: number
  healthPath?: string
}): Promise<PortForward> {
  const child: ChildProcess = spawn(
    'kubectl',
    ['-n', opts.namespace, 'port-forward', opts.target, `${opts.localPort}:${opts.remotePort}`],
    { stdio: 'ignore' },
  )
  const url = `http://127.0.0.1:${opts.localPort}`
  const reachable = await waitReachable(`${url}${opts.healthPath ?? '/health'}`)
  if (!reachable) {
    child.kill()
    throw new Error(`port-forward to ${opts.target} never became reachable on :${opts.localPort}`)
  }
  return { url, stop: () => child.kill() }
}

async function waitReachable(url: string, attempts = 60): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    const ok = await fetch(url, { signal: AbortSignal.timeout(1000) })
      .then((r) => r.ok)
      .catch(() => false)
    if (ok) return true
    await delay(500)
  }
  return false
}

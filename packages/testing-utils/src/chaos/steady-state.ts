import { delay } from './timing'

/** One observation of the steady-state hypothesis. `ok=false` means the invariant was violated. */
export interface ProbeResult {
  ok: boolean
  detail?: string
}

/**
 * A steady-state hypothesis: an observable invariant the system must satisfy. "Property check,
 * not a stunt" (ADR-0014) — the probe asserts a *documented* behaviour (a 2xx, or a typed
 * retryable problem, bounded latency), never merely "no errors".
 */
export interface SteadyStateHypothesis {
  name: string
  probe: () => Promise<ProbeResult>
}

export interface PhaseSamples {
  held: boolean
  results: ProbeResult[]
}

export interface SteadyStateRun {
  hypothesis: string
  before: PhaseSamples
  during: PhaseSamples
  after: PhaseSamples
  /** Held healthy AND during chaos AND after recovery — the Milestone 6 exit criterion. */
  held: boolean
}

/** Probe `count` times at `intervalMs`; the phase holds iff every sample held. */
export async function sample(
  hypothesis: SteadyStateHypothesis,
  count: number,
  intervalMs: number,
): Promise<PhaseSamples> {
  const results: ProbeResult[] = []
  for (let i = 0; i < count; i += 1) {
    results.push(await hypothesis.probe())
    if (i < count - 1) await delay(intervalMs)
  }
  return { held: results.every((r) => r.ok), results }
}

/**
 * Recovery: poll `probe` until it holds (returns ok) or the attempt budget is spent. Used for the
 * after-chaos phase when the system must actively return to a STRICTER condition (e.g. back to a
 * 200, not merely a bounded 502) — otherwise an after-phase that accepts the degraded response
 * would pass even if the system never recovered. Polls so a breaker cooldown / pod restart has
 * time to clear.
 */
export interface RecoveryCheck {
  probe: () => Promise<ProbeResult>
  withinMs?: number
  intervalMs?: number
}

async function pollRecovery(recover: RecoveryCheck): Promise<PhaseSamples> {
  const intervalMs = recover.intervalMs ?? 1000
  const attempts = Math.max(1, Math.ceil((recover.withinMs ?? 30_000) / intervalMs))
  const results: ProbeResult[] = []
  for (let i = 0; i < attempts; i += 1) {
    const result = await recover.probe()
    results.push(result)
    if (result.ok) return { held: true, results }
    if (i < attempts - 1) await delay(intervalMs)
  }
  return { held: false, results }
}

/**
 * Run a hypothesis through the three chaos phases: establish a healthy baseline, inject the
 * fault and re-assert (the fault must NOT break the documented behaviour), then heal and assert
 * recovery. `inject` AND the during-sample are inside the `try`, so `heal` in the `finally`
 * always runs — even if `inject` (e.g. waitForInjection) throws after the fault is applied — and
 * the cluster is never left perturbed. The returned `held` is the conjunction the exit criterion
 * requires. When `recover` is given, the after-phase polls it (asserting active recovery to the
 * stricter condition) instead of sampling the bounded hypothesis.
 */
export async function runSteadyState(opts: {
  hypothesis: SteadyStateHypothesis
  inject: () => Promise<void>
  heal: () => Promise<void>
  samples?: number
  intervalMs?: number
  recover?: RecoveryCheck
}): Promise<SteadyStateRun> {
  const count = opts.samples ?? 5
  const intervalMs = opts.intervalMs ?? 500
  const before = await sample(opts.hypothesis, count, intervalMs)

  let during: PhaseSamples
  try {
    await opts.inject()
    during = await sample(opts.hypothesis, count, intervalMs)
  } finally {
    await opts.heal()
  }
  const after = opts.recover
    ? await pollRecovery(opts.recover)
    : await sample(opts.hypothesis, count, intervalMs)

  return {
    hypothesis: opts.hypothesis.name,
    before,
    during,
    after,
    held: before.held && during.held && after.held,
  }
}

import os from 'node:os'

/**
 * Multiplier for vitest timeout caps, derived from how starved the host already is.
 *
 * A timeout cap is a hung-test guard, not a budget: on a quiet machine it should stay
 * tight so real hangs surface fast. But the PGlite-heavy property suites stretch
 * linearly with contention, and the host is routinely oversubscribed by design — the
 * k3d cluster, an act runner, the rest of a `turbo run test` sweep. A fixed cap turns
 * that starvation into flakes that hop packages between runs. Scaling by loadavg/cores
 * keeps the guard honest in both worlds; the clamp stops a pathological loadavg from
 * deferring real-hang detection past ~8x.
 */
export const contentionMultiplier = (loadAvg1m: number, cores: number): number =>
  Math.min(8, Math.max(1, loadAvg1m / Math.max(1, cores)))

/**
 * Load-aware timeout cap for vitest configs: `base` on a quiet machine, scaled under
 * contention. Sampled once per vitest process start, so suites launched later in a
 * sweep see the load the sweep itself created.
 */
export const contentionAwareTimeout = (baseMs: number): number =>
  Math.round(baseMs * contentionMultiplier(os.loadavg()[0] ?? 0, os.cpus().length))

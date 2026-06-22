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
 * deferring real-hang detection past ~8x. `floor` raises the minimum multiplier when
 * contention is known to be coming but the instantaneous loadavg has not caught up yet.
 */
export const contentionMultiplier = (loadAvg1m: number, cores: number, floor = 1): number =>
  Math.min(8, Math.max(floor, loadAvg1m / Math.max(1, cores)))

/**
 * Is this vitest process a task inside a `turbo run` sweep? Turbo injects `TURBO_HASH` into
 * every task's environment, so its presence distinguishes a parallel sweep (many PGlite suites
 * competing for cores) from a solo `vitest run`.
 */
const inTurboSweep = (): boolean => (process.env.TURBO_HASH ?? '').length > 0

/**
 * Load-aware timeout cap for vitest configs: `base` on a quiet machine, scaled under
 * contention. The loadavg is sampled once per vitest process start, so a suite launched LATE
 * in a sweep sees the load the sweep created — but a suite scheduled FIRST samples a near-idle
 * machine, locks a tight cap, then gets starved as the rest of the sweep spins up. That
 * sample-too-early race is the documented false-timeout (a heavy suite that runs ~15s solo
 * blowing a 60s cap only during a cold parallel sweep). Inside a turbo sweep we therefore floor
 * the multiplier at 2x: contention is guaranteed, so give headroom even before loadavg catches
 * up. Still a hung-test guard (a true hang dies at 2x-8x base, not never); solo runs keep the
 * tight 1x cap so real hangs there surface fast.
 */
export const contentionAwareTimeout = (baseMs: number): number =>
  Math.round(
    baseMs * contentionMultiplier(os.loadavg()[0] ?? 0, os.cpus().length, inTurboSweep() ? 2 : 1),
  )

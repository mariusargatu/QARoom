// k6 load PROFILES (T17 — perf depth). One exec fn + one SLO projection, three load SHAPES:
//
//   default — the committed warmup + measure constant-arrival-rate run. Unchanged: it confirms the
//             service holds the SLO at a fixed target rate (a point, not the envelope).
//   soak    — ramping-vus held flat for a long duration. A memory / file-descriptor / connection
//             leak shows up as latency that DRIFTS UP over time, so soak REUSES the SLO latency
//             thresholds: a leak that degrades p95/p99 over the hold breaches them and turns red.
//   stress  — ramping-arrival-rate climbing PAST capacity to find the breaking point. There is NO
//             hard threshold here (it is EXPECTED to break) — the summary's escalating p95 and
//             error-rate IS the evidence; the run completes and records where it bent.
//
// Pick a shape with K6_PROFILE=soak|stress (anything else = default). All three name their measure
// scenario `measure`, so the committed `measureThresholds()` and the `pnpm k6:results` fold (which
// both key off {scenario:measure}) keep working untouched — only the executor and the output
// filename change. This keeps the constant-arrival-rate gate the single SLO source of truth.

const ENV = typeof __ENV !== 'undefined' ? __ENV : {}

export function k6Profile() {
  const p = ENV.K6_PROFILE || 'default'
  return p === 'soak' || p === 'stress' ? p : 'default'
}

// Swap the scenario set for the active profile. `defaultScenarios` is passed in so each script keeps
// its own committed warmup/measure rates as the default (feed and vote-cast differ).
export function selectScenarios(defaultScenarios, exec) {
  const p = k6Profile()
  if (p === 'soak') return soakScenarios(exec)
  if (p === 'stress') return stressScenarios(exec)
  return defaultScenarios
}

// Keep the SLO gate for default + soak (a leak must breach it); for stress, swap it for never-failing
// thresholds. Stress is EXPECTED to break, so it must not gate red — but a tagged {scenario:measure}
// sub-metric only materialises in the summary when a threshold references it, and the k6:results fold
// reads exactly those. These bounds (p99 ≥ 0, error rate ≥ 0) can never breach, so stress stays
// un-gated yet still folds its aggregate p95/error-rate; the climb-to-failure curve lives in the raw
// summary artifact. The SLO numbers themselves stay sourced only from `measureThresholds()`.
export function thresholdsForProfile(sloThresholds) {
  if (k6Profile() !== 'stress') return sloThresholds
  return {
    'http_req_waiting{scenario:measure}': ['p(99)>=0'],
    'http_req_failed{scenario:measure}': ['rate>=0'],
  }
}

// Distinct output file per profile so a soak/stress run never clobbers the gated default evidence.
// The k6:results glob (test-results/k6-*.json) then folds each as its own script (e.g. feed-soak).
export function outputFileFor(base) {
  const p = k6Profile()
  return p === 'default' ? `test-results/k6-${base}.json` : `test-results/k6-${base}-${p}.json`
}

// Sustained flat load over a long hold: ramp up, hold (where a leak reveals itself), ramp down.
function soakScenarios(exec) {
  const vus = Number(ENV.K6_SOAK_VUS || 20)
  const ramp = ENV.K6_SOAK_RAMP || '30s'
  return {
    measure: {
      executor: 'ramping-vus',
      exec,
      startVUs: 0,
      stages: [
        { duration: ramp, target: vus },
        { duration: ENV.K6_SOAK_DURATION || '10m', target: vus },
        { duration: ramp, target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  }
}

// Arrival rate climbing in steps to a peak well past the warm target, then back to zero. The step
// where http_req_failed lifts off (and p95 blows the SLO) marks the breaking point.
function stressScenarios(exec) {
  const peak = Number(ENV.K6_STRESS_PEAK_RATE || 800)
  return {
    measure: {
      executor: 'ramping-arrival-rate',
      exec,
      startRate: Number(ENV.K6_STRESS_START_RATE || 50),
      timeUnit: '1s',
      preAllocatedVUs: Number(ENV.K6_STRESS_PRE_VUS || 50),
      maxVUs: Number(ENV.K6_STRESS_MAX_VUS || 500),
      stages: [
        { duration: '20s', target: Math.round(peak * 0.125) },
        { duration: '20s', target: Math.round(peak * 0.25) },
        { duration: '20s', target: Math.round(peak * 0.5) },
        { duration: '20s', target: peak },
        { duration: '20s', target: 0 },
      ],
    },
  }
}

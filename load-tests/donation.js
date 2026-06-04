// k6 load test — donation flow. Gates `POST /api/communities/{id}/donations` against the donation
// SLO (docs/slos.md). Unlike vote/feed (content-only), the donation flow needs the full stack:
// donations-service + a reachable payment provider (Microcks mock) + the `donations` flag ENABLED
// for the community (via the flags rollout). Run this against the local cluster (`pnpm dev`) with the
// flag enabled — it is NOT wired into the minimal CI `load` job (that would drag Microcks+NATS+flags
// into the lane). See load-tests/README.md.

import { check } from 'k6'
import http from 'k6/http'
import { brandedId, COMM_GENERAL } from './lib/branded.js'
import { measureThresholds } from './lib/thresholds.js'

const SLO = JSON.parse(open('./lib/slo-thresholds.gen.json'))
const BASE = __ENV.DONATIONS_BASE_URL || 'http://localhost:8084'

export const options = {
  scenarios: {
    warmup: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.K6_WARMUP_RATE || 5),
      timeUnit: '1s',
      duration: '5s',
      preAllocatedVUs: 5,
      maxVUs: 10,
      startTime: '0s',
      exec: 'donate',
    },
    measure: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.K6_RATE || 10),
      timeUnit: '1s',
      duration: __ENV.K6_DURATION || '20s',
      preAllocatedVUs: 10,
      maxVUs: 20,
      startTime: '6s',
      exec: 'donate',
    },
  },
  thresholds: measureThresholds(SLO, 'donation'),
  summaryTrendStats: ['med', 'p(50)', 'p(95)', 'p(99)', 'max', 'count'],
}

export function donate() {
  const donor = brandedId('user', 5000 + __VU * 1_000_000 + __ITER)
  const res = http.post(
    `${BASE}/api/communities/${COMM_GENERAL}/donations`,
    JSON.stringify({ donor_id: donor, amount_cents: 2500, currency: 'USD' }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `k6-donate-${__VU}-${__ITER}`,
      },
      tags: { endpoint: 'donation' },
    },
  )
  // 201 created; a 403 means the donations flag is not enabled for this community (see README).
  check(res, { 'donation 201': (r) => r.status === 201 })
}

export function handleSummary(data) {
  return { 'test-results/k6-donation.json': JSON.stringify(data, null, 2) }
}

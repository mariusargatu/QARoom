// k6 load test — vote casting (write-heavy), the Milestone-8 SLO exit-criterion script.
// Gates `POST /api/posts/{postId}/votes` against the castVote SLO (docs/slos.md). The deliberate
// slow-path toggle CONTENT_BUG_VOTE_SLOW_MS on content-service breaches http_req_waiting and turns
// this red (the negative test); clean it is green. Hits content-service directly (no gateway/auth),
// mirroring the CI `fuzz` job's minimal bring-up.

import { check } from 'k6'
import http from 'k6/http'
import { brandedId, COMM_GENERAL } from './lib/branded.js'
import { outputFileFor, selectScenarios, thresholdsForProfile } from './lib/profiles.js'
import { measureThresholds } from './lib/thresholds.js'

const SLO = JSON.parse(open('./lib/slo-thresholds.gen.json'))
const BASE = __ENV.CONTENT_BASE_URL || 'http://localhost:8081'
const AUTHOR = brandedId('user', 1)

// The default constant-arrival-rate shape (the committed SLO gate + the slow-path negative test).
// K6_PROFILE=soak|stress swaps in the long-hold / climb-to-failure shapes (T17); default unchanged.
const DEFAULT_SCENARIOS = {
  warmup: {
    executor: 'constant-arrival-rate',
    rate: Number(__ENV.K6_WARMUP_RATE || 20),
    timeUnit: '1s',
    duration: '5s',
    preAllocatedVUs: 10,
    maxVUs: 20,
    startTime: '0s',
    exec: 'castVote',
  },
  measure: {
    executor: 'constant-arrival-rate',
    rate: Number(__ENV.K6_RATE || 30),
    timeUnit: '1s',
    duration: __ENV.K6_DURATION || '20s',
    preAllocatedVUs: 10,
    maxVUs: 30,
    startTime: '6s',
    exec: 'castVote',
  },
}

export const options = {
  scenarios: selectScenarios(DEFAULT_SCENARIOS, 'castVote'),
  thresholds: thresholdsForProfile(measureThresholds(SLO, 'castVote')),
  summaryTrendStats: ['med', 'p(50)', 'p(95)', 'p(99)', 'max', 'count'],
}

export function setup() {
  const res = http.post(
    `${BASE}/api/communities/${COMM_GENERAL}/posts`,
    JSON.stringify({ author_id: AUTHOR, title: 'k6 load post', body: 'vote target' }),
    { headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'k6-setup-vote-post' } },
  )
  check(res, { 'setup created post': (r) => r.status === 201 })
  return { postId: res.json('id') }
}

export function castVote(data) {
  // Unique voter per iteration so each call is a real write, not an idempotent replay.
  const voter = brandedId('user', 1000 + __VU * 1_000_000 + __ITER)
  const value = __ITER % 2 === 0 ? 1 : -1
  const res = http.post(
    `${BASE}/api/posts/${data.postId}/votes`,
    JSON.stringify({ voter_id: voter, value }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `k6-vote-${__VU}-${__ITER}`,
      },
      tags: { endpoint: 'castVote' },
    },
  )
  check(res, { 'vote 200': (r) => r.status === 200 })
}

export function handleSummary(data) {
  return { [outputFileFor('vote-cast')]: JSON.stringify(data, null, 2) }
}

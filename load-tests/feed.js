// k6 load test — feed retrieval (read-heavy). Gates `GET /api/communities/{id}/feed` against the
// feed SLO (docs/slos.md). Hits content-service directly. setup() seeds a handful of posts so the
// feed has content; the measure scenario hammers the read path.

import { check } from 'k6'
import http from 'k6/http'
import { brandedId, COMM_GENERAL } from './lib/branded.js'
import { measureThresholds } from './lib/thresholds.js'

const SLO = JSON.parse(open('./lib/slo-thresholds.gen.json'))
const BASE = __ENV.CONTENT_BASE_URL || 'http://localhost:8081'
const AUTHOR = brandedId('user', 2)
const SEED_POSTS = Number(__ENV.K6_SEED_POSTS || 10)

export const options = {
  scenarios: {
    warmup: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.K6_WARMUP_RATE || 30),
      timeUnit: '1s',
      duration: '5s',
      preAllocatedVUs: 10,
      maxVUs: 30,
      startTime: '0s',
      exec: 'readFeed',
    },
    measure: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.K6_RATE || 50),
      timeUnit: '1s',
      duration: __ENV.K6_DURATION || '20s',
      preAllocatedVUs: 20,
      maxVUs: 50,
      startTime: '6s',
      exec: 'readFeed',
    },
  },
  thresholds: measureThresholds(SLO, 'feed'),
  summaryTrendStats: ['med', 'p(50)', 'p(95)', 'p(99)', 'max', 'count'],
}

export function setup() {
  for (let i = 0; i < SEED_POSTS; i++) {
    http.post(
      `${BASE}/api/communities/${COMM_GENERAL}/posts`,
      JSON.stringify({ author_id: AUTHOR, title: `seed ${i}`, body: `feed seed post ${i}` }),
      { headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `k6-seed-feed-${i}` } },
    )
  }
}

export function readFeed() {
  const res = http.get(`${BASE}/api/communities/${COMM_GENERAL}/feed`, {
    tags: { endpoint: 'feed' },
  })
  check(res, { 'feed 200': (r) => r.status === 200 })
}

export function handleSummary(data) {
  return { 'test-results/k6-feed.json': JSON.stringify(data, null, 2) }
}

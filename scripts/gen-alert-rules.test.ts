import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CONSUMER_LAG_SLO, SLO_TARGETS } from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'
import { renderAlertRules } from './gen-alert-rules'

const ROOT = process.cwd()
const committedPath = resolve(ROOT, 'deploy/observability/alerts.gen.yaml')

describe('gen-alert-rules drift gate', () => {
  // The committed alert rules must be byte-identical to a fresh render, so an SLO change cannot ship
  // without regenerating the thresholds (`pnpm alerts:gen`) — the k6:gen one-source discipline.
  it('alerts.gen.yaml is byte-identical to a fresh render', () => {
    expect(readFileSync(committedPath, 'utf8')).toBe(renderAlertRules())
  })
})

describe('alert thresholds derive from the SLO source', () => {
  const rendered = renderAlertRules()

  it('embeds the createPost error-rate SLO, never a hand-typed copy', () => {
    expect(rendered).toContain(`> ${SLO_TARGETS.createPost.errorRate}`)
  })

  it('embeds the createPost p95 latency SLO in seconds', () => {
    const p95Seconds = (SLO_TARGETS.createPost.latencyMs?.p95 ?? 0) / 1000
    expect(rendered).toContain(`> ${p95Seconds}`)
  })

  it('embeds the consumer-lag pending + ack-age SLO bounds', () => {
    expect(rendered).toContain(`qaroom_consumer_num_pending > ${CONSUMER_LAG_SLO.maxPending}`)
    expect(rendered).toContain(
      `qaroom_consumer_oldest_unacked_age_seconds > ${CONSUMER_LAG_SLO.maxAckAgeMs / 1000}`,
    )
  })
})

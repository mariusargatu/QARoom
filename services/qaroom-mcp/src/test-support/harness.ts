import type { TestResultsSummary } from '@qaroom/contracts'
import { createSeededDeps } from '@qaroom/testing-utils/harness'
import {
  type FixtureRoute,
  fixtureServiceClient,
  jsonResponse,
} from '../client/fixture-service-client'
import type { ServiceClient } from '../deps'
import { McpCore } from '../server/core'
import { type SummaryProvider, staticSummaryProvider } from '../server/summary-provider'
import type { McpClient } from '../transport/client'
import { inMemoryClient } from '../transport/in-memory'

/**
 * Shared in-memory test substrate. The MCP core holds no database, so the harness
 * composes the seeded determinism trio (createSeededDeps) with a deterministic fixture
 * ServiceClient and a pinned summary — every call is reproducible without booting Postgres.
 */
const AS_OF = { snapshot_id: 'snap_fixture', lamport: 7, wall_clock: '2026-01-01T00:00:00.000Z' }

export const FIXTURE_SUMMARY: TestResultsSummary = {
  schema_version: 1,
  generated_at: '2026-01-01T00:00:00.000Z',
  commit: 'test0000',
  totals: { passed: 42, failed: 0, skipped: 1 },
  runners: [
    {
      name: 'qaroom-mcp',
      passed: 42,
      failed: 0,
      skipped: 1,
      duration_ms: 1234,
      output: { gates: 4 },
      seeds: {},
    },
  ],
}

const FEED_BODY = { community_id: 'comm_fixture', posts: [], as_of: AS_OF }
const POST_BODY = {
  id: 'post_fixture',
  community_id: 'comm_fixture',
  title: 'fixture',
  body: 'fixture',
  score: 3,
  as_of: AS_OF,
}
const STATE_CONTENT = {
  service: 'content',
  models: { posts: { count: 2 }, votes: { count: 5 } },
  as_of: AS_OF,
}
const STATE_GATEWAY = {
  service: 'gateway',
  models: { rate_limiter: { capacity: 100 } },
  as_of: AS_OF,
}
const LIMITS = {
  service: 'gateway',
  principal: 'ip:test',
  limit: 100,
  remaining: 99,
  reset_in_seconds: 30,
  as_of: AS_OF,
}

export function defaultRoutes(): FixtureRoute[] {
  return [
    { service: 'content', path: /^\/api\/posts\/[^/]+$/, response: jsonResponse(200, POST_BODY) },
    {
      service: 'content',
      path: /^\/api\/communities\/[^/]+\/feed$/,
      response: jsonResponse(200, FEED_BODY),
    },
    { service: 'content', path: '/system/state', response: jsonResponse(200, STATE_CONTENT) },
    { service: 'gateway', path: /^\/api\/posts\/[^/]+$/, response: jsonResponse(200, POST_BODY) },
    {
      service: 'gateway',
      path: /^\/api\/communities\/[^/]+\/feed$/,
      response: jsonResponse(200, FEED_BODY),
    },
    { service: 'gateway', path: '/system/state', response: jsonResponse(200, STATE_GATEWAY) },
    { service: 'gateway', path: '/system/limits', response: jsonResponse(200, LIMITS) },
  ]
}

export interface McpHarness {
  core: McpCore
  client: McpClient
  services: ServiceClient
}

export interface HarnessOptions {
  services?: ServiceClient
  summary?: SummaryProvider
}

export function setupMcpInMemory(options: HarnessOptions = {}): McpHarness {
  const { clock, ids } = createSeededDeps()
  const services =
    options.services ?? fixtureServiceClient(defaultRoutes(), jsonResponse(200, { ok: true }))
  const summary = options.summary ?? staticSummaryProvider(FIXTURE_SUMMARY)
  const core = new McpCore({ deps: { clock, ids }, services, summary })
  return { core, client: inMemoryClient(core), services }
}

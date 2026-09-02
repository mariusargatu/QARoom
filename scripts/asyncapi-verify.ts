import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { asyncapiBreakingChanges } from '@qaroom/testing-utils/async-diff'
import { parse } from 'yaml'
import { assertServiceListCoversWorkspace, runWorkspaceScript } from './lib/workspace-script'

/**
 * The AsyncAPI DRIFT gate (ADR-0002, the async mirror of `openapi-verify.ts`): regenerate each
 * service's `asyncapi.yaml` from Zod and fail if the committed file differs.
 *
 * The classifier self-test that used to live here (two synthetic fixtures, proving the detector
 * fires) moved to `contract:breaking` on 2026-08-11 — it guards the gate that USES the classifier,
 * and asserting it here implied this script checked QARoom's specs for breaking changes, which it
 * never did. The classifier's own behaviour is unit-tested in `async-diff/classifier.test.ts`.
 */
const ROOT = process.cwd()
const DRIFT_SERVICES = ['content', 'flags', 'donations', 'gateway', 'webhooks'] as const

/** Deliberately outside this gate, with the reason — not a bare allowlist. */
const DRIFT_EXEMPT = {
  'moderator-agent':
    'Python service (uv/FastAPI): its asyncapi drift is checked by pytest in the nightly moderator lane; this in-process gate has no uv.',
} as const

assertServiceListCoversWorkspace(DRIFT_SERVICES, 'asyncapi:generate', DRIFT_EXEMPT)

function checkDrift(svc: string): void {
  const specPath = resolve(ROOT, `services/${svc}/asyncapi.yaml`)
  const before = readFileSync(specPath, 'utf8')
  runWorkspaceScript(`@qaroom/${svc}`, 'asyncapi:generate')
  const after = readFileSync(specPath, 'utf8')
  if (before !== after) {
    process.stderr.write(
      `AsyncAPI drift: committed services/${svc}/asyncapi.yaml was stale. It has been regenerated — commit the result.\n`,
    )
    process.exit(1)
  }
  process.stdout.write(`asyncapi drift gate (${svc}): committed spec matches Zod ✓\n`)
}

for (const svc of DRIFT_SERVICES) checkDrift(svc)

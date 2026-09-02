import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertServiceListCoversWorkspace, runWorkspaceScript } from './lib/workspace-script'

/**
 * The OpenAPI DRIFT gate (Commitment 3): regenerate each service's openapi.yaml from Zod and fail
 * if the committed file differs — the round-trip must hold.
 *
 * One gate, not two, since 2026-08-11. This script used to also run oasdiff against two synthetic
 * fixtures to prove the tool detects a breaking change. That check never looked at a QARoom spec —
 * remove a required response field from a real service, regenerate, commit, and BOTH halves passed
 * — and it forced this otherwise pure Zod-vs-file comparison to shell out to Docker. The detector
 * self-test now lives in `contract:breaking`, the gate that actually depends on it.
 *
 * Both halves of the drift check must prove they RAN: `pnpm --filter` exits 0 when the filter matches
 * nothing and when the matched package has no such script, so a read-before/read-after diff
 * reads a silent no-op as "no drift". `runWorkspaceScript` throws on either, and the service
 * list below is pinned to what the workspace actually declares.
 */
const ROOT = process.cwd()
const DRIFT_SERVICES = ['content', 'identity', 'gateway', 'flags', 'donations', 'webhooks'] as const

/** Deliberately outside this gate, with the reason — not a bare allowlist. */
const DRIFT_EXEMPT = {
  'moderator-agent':
    'Python service (uv/FastAPI): its openapi drift is checked by pytest in the nightly moderator lane; this in-process gate has no uv.',
} as const

assertServiceListCoversWorkspace(DRIFT_SERVICES, 'openapi:generate', DRIFT_EXEMPT)

/** Regenerate one service's OpenAPI and fail if the committed file is stale. */
function checkDrift(svc: string): void {
  const specPath = resolve(ROOT, `services/${svc}/openapi.yaml`)
  const before = readFileSync(specPath, 'utf8')
  runWorkspaceScript(`@qaroom/${svc}`, 'openapi:generate')
  const after = readFileSync(specPath, 'utf8')
  if (before !== after) {
    process.stderr.write(
      `OpenAPI drift: committed services/${svc}/openapi.yaml was stale. It has been regenerated — commit the result.\n`,
    )
    process.exit(1)
  }
  process.stdout.write(`openapi drift gate (${svc}): committed spec matches Zod ✓\n`)
}

for (const svc of DRIFT_SERVICES) checkDrift(svc)

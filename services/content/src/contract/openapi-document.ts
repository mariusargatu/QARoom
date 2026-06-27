import { buildServiceOpenApiYaml } from '@qaroom/service-kit'
import { OPERATIONS } from './operations'

/**
 * Single source for the content-service OpenAPI document params. The build
 * script and the round-trip test both call this, so they cannot drift.
 *
 * AGENTIC-BOUNDARY toggle (Boundary 16, ADR-0032). `AGENT_DESYNC_OPENAPI` is the deliberate-bug
 * env var behind the `agent-cannot-silently-desync` claim: it models an agent that hand-edits the
 * generated artifact (or the Zod schema) and leaves the committed `openapi.yaml` behind. Armed, the
 * generated document drifts from the committed spec, so BOTH the read-only round-trip spec
 * (tests/openapi-roundtrip.spec.ts) and the `pnpm openapi:verify` drift gate go RED. This is the one
 * place the toggle is read; it is unguarded (no production-mode predicate) so the matrix census
 * classifies it cleanly.
 */
export function contentOpenApiYaml(): string {
  const desynced = process.env.AGENT_DESYNC_OPENAPI === '1'
  return buildServiceOpenApiYaml(
    {
      title: 'QARoom content-service',
      version: '0.0.0',
      description: desynced
        ? 'Posts and votes within communities. Generated from Zod — agent-desynced edit (AGENT_DESYNC_OPENAPI).'
        : 'Posts and votes within communities. Generated from Zod — do not edit by hand.',
    },
    OPERATIONS,
    [{ url: 'http://localhost:8081', description: 'local docker-compose' }],
  )
}

import { z } from 'zod'
import { BOUNDARIES } from './claims'

/**
 * The ONE boundary registry (the 2026-06-11 critique found three hand-maintained boundary
 * enumerations drifted apart: README showed 9 rows, 02-architecture 11, and 03's central map
 * predated Milestones 9 and 11 entirely). This file is the source; the README table is rendered
 * from it (`pnpm boundaries:render`, byte-gated by `pnpm claims:verify`), and 02/03 prose is
 * synced against it by review.
 *
 * `lanes` maps each documentation row onto the claim-manifest lane(s) (the BOUNDARIES enum) that
 * gate it. Two rows are doc-level composites with no enum lane of their own: `state` (the XState
 * machines cut across flags/webhooks/identity) and `delivery-edge` (its guarantees are gated
 * through the trust and process-async lanes; that is why the webhook-signing claim carries
 * boundary `trust` while the README row says delivery edge).
 */

export const BoundaryEntry = z.object({
  id: z.string(),
  label: z.string(),
  breaks: z.string(),
  leadTechnique: z.string(),
  lanes: z.array(z.enum(BOUNDARIES)),
})
export type BoundaryEntry = z.infer<typeof BoundaryEntry>

const RAW: BoundaryEntry[] = [
  {
    id: 'trust',
    label: 'Trust (client to gateway)',
    breaks: 'malformed or hostile input',
    leadTechnique: 'Schemathesis fuzzing, RFC 7807 errors',
    lanes: ['trust'],
  },
  {
    id: 'process-rest',
    label: 'Process (service to service)',
    breaks: 'a contract drifts between two services',
    leadTechnique: 'Pact v4 contracts, cross-checked against the published OpenAPI',
    lanes: ['process-rest'],
  },
  {
    id: 'process-async',
    label: 'Async (events over NATS)',
    breaks: 'a lost, duplicated, or reordered event',
    leadTechnique: 'typed events, outbox, dedup, async Pact, Tracetest',
    lanes: ['process-async'],
  },
  {
    id: 'state',
    label: 'State (rollouts, webhook delivery, migration)',
    breaks: 'an illegal state transition',
    leadTechnique: 'XState machines, reverse-conformance, model-based testing',
    lanes: [],
  },
  {
    id: 'temporal',
    label: 'Temporal',
    breaks: 'logic that depends on the wall clock',
    leadTechnique: 'an injected `Clock`, no real time in non-test code',
    lanes: ['temporal'],
  },
  {
    id: 'tenancy',
    label: 'Tenancy (communities as tenants)',
    breaks: "one tenant reads another tenant's data",
    leadTechnique: 'property-based isolation tests',
    lanes: ['tenancy'],
  },
  {
    id: 'identity-issuance',
    label: 'Identity issuance (JWT and JWKS)',
    breaks: 'a token signed with a retired key, a rotation that strands sessions',
    leadTechnique: 'JWKS contract tests, rotation as a state machine',
    lanes: ['identity-issuance'],
  },
  {
    id: 'websocket',
    label: 'WebSocket push',
    breaks: 'a stale socket, an unauthorized subscription, push/poll divergence',
    leadTechnique: 'one-use ticket auth, polling-parity tests',
    lanes: ['websocket'],
  },
  {
    id: 'observability',
    label: 'Observability',
    breaks: 'a span without its tenant, a trace that breaks',
    leadTechnique: 'every span carries `tenant.id`, checked live',
    lanes: ['observability'],
  },
  {
    id: 'external-dep',
    label: 'External dependency (the LLM moderator)',
    breaks: 'a hallucinated or overconfident decision',
    leadTechnique: 'retrieval grounding, eval, red-team, an abstain path',
    lanes: ['external-dep'],
  },
  {
    id: 'payment-edge',
    label: 'External payment (donations to the payment provider)',
    breaks: 'the payment provider faults, declines, or its REST contract drifts',
    leadTechnique:
      'a Microcks contract mock, an injectable payment-client seam, RFC 7807 `dependency_failure` on a fault',
    lanes: ['external-dep', 'process-rest'],
  },
  {
    id: 'delivery-edge',
    label: 'Delivery edge (outbound webhooks)',
    breaks: 'a replayed, dropped, or unsafe delivery',
    leadTechnique: 'HMAC signing, SSRF guard, at-least-once with retries',
    lanes: ['trust', 'process-async'],
  },
]

export const BOUNDARY_REGISTRY: readonly BoundaryEntry[] = z.array(BoundaryEntry).parse(RAW)

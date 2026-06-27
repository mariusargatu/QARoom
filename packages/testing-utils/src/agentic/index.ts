/**
 * Boundary 16 — agentic development as a tested boundary (ADR-0032 / ADR-0033). The public surface of
 * the agentic-boundary gates, so the orchestration scripts (`scripts/deriver-conformance.ts`,
 * `scripts/prove-adversarial.ts`) can reach the audit + taxonomy without deep-importing internals.
 */

export {
  ATTACK_TAXONOMY,
  type AttackCase,
  type AttackFamily,
  type AttackId,
  type AttackVerdict,
  killRatioOf,
  runAdversarialTaxonomy,
} from './adversarial-taxonomy'
export { auditVoteValueArbConformance, type ConformanceResult } from './deriver-conformance'

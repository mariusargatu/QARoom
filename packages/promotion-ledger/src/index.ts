/**
 * @qaroom/promotion-ledger — the green_head / risk-tier / state-aware-revert core (T24, ADR-0037).
 * The package's public surface; internal modules import each other directly (no barrels for internal
 * APIs, per the repo conventions). This file IS the public API.
 */

export {
  type ChangeClass,
  type ChangeClassification,
  classifyChange,
  isAutoRevertable,
  type RevertPolicy,
} from './change-class'
export { greenHead, greenHeadLag } from './green-head'
export {
  append,
  type BatchRange,
  evidenceHash,
  hasOutstandingRevert,
  highestGreenTier,
  isGreenAtTier,
  LedgerRow,
  parseLedger,
  rowsFor,
  serializeRow,
} from './ledger'
export { TIERS, type Tier, tierAtLeast, tierRank } from './tiers'
export {
  classifyVerdict,
  FLAKE_CONFIRM_RATIO,
  MIN_CULPRIT_CONFIDENCE,
  type RunSignal,
  type Verdict,
} from './verdict'

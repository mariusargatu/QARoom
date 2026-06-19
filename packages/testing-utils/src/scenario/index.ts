// Public surface of the deterministic scenario harness (UNIT-L1-PLAN.md §3.7). The fault primitives
// (failingDb, brokerDouble) + determinism helpers compose with each service's own app factory in its
// scenario catalog; outbound-HTTP faulting is the existing `@qaroom/testing-utils/http` module
// (mockUpstream / hangingFetch) plus each service's folded upstream-double factory.
export type { BrokerDouble, BrokerMode, PublishedMessage } from './broker-double'
export { brokerDouble } from './broker-double'
export type { FailMatcher, FailOp } from './failing-db'
export { failingDb, InjectedDbError } from './failing-db'
export type { DeterminismCheck, ScenarioOutcome } from './run-scenario'
export { captureScenario, runTwiceAndDiff, structuralFingerprint } from './run-scenario'

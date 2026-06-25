# Testing-architecture views (custom views over model/testing.dsl). These are the standalone
# "map the testing too" diagrams; the per-container TESTING perspective in platform.dsl overlays
# the same story onto the C4 structure.

custom "TestingBoundaryMap" "Testing: the boundary map" "The central artifact: every architectural boundary and the technique(s) that defend it (per scripts/lib/manifests/boundary-registry.ts + docs/03 §5)." {
    include bTrust bProcessRest bProcessAsync bState bTemporal bTenancy bIdentity bWebsocket bObservability bExternalDep bPaymentEdge bDeliveryEdge
    include tSchemathesis tZod tPactRest tCrosscheck tPactMsg tTracetest tProperty tMbt tClock tComponent tIntegration tMicrocks tChaos
    include tDeepeval tDeepteam tPyrit tMetamorphic tLanggraphRC
    autolayout lr
}

custom "TestingHoneycombTiers" "Testing: the honeycomb, by tier" "The technique portfolio grouped by cost tier: in-process (Vitest/pytest) -> cluster-live (k3d) -> LLM evaluation (key-gated). ARCHITECTURE.md §3, docs/gauntlet.md." {
    include tUnit tProperty tZod tClock tPactRest tPactMsg tCrosscheck tIntegration tComponent tMutation
    include tSchemathesis tEvomaster tMbt tTracetest tMicrocks tChaos tK6 tReplay
    include tDeepeval tDeepteam tPyrit tMetamorphic tLanggraphRC
    autolayout tb
}

custom "FalsifiableClaims" "Testing: the eleven falsifiable claims" "Each claim holds without its toggle and goes RED with it (pnpm prove <id> --break); the manifest can never decay into theater (pnpm claims:verify). docs/claims.md." {
    include clSign clAtLeastOnce clAbstain clApprove clInputGuard clCorpusGuard clVote clTenant clEventsPoll clSpan clOutbox
    include bDeliveryEdge bExternalDep bProcessRest bTenancy bObservability bProcessAsync
    autolayout lr
}

custom "Triangulation" "Testing: contract triangulation" "Zod is the single source; OpenAPI/AsyncAPI are generated + committed; Pact is independently authored. Four tools, four directions of agreement, no silent drift (ADR-0001 C3)." {
    include gZod gOpenapi gAsyncapi gPact gOasdiff tCrosscheck tSchemathesis tPactRest
    autolayout lr
}

custom "EvidenceGovernance" "Testing: evidence + governance" "Every runner folds into a frozen-schema envelope that the drift gates and the gauntlet read; numbers are projected, never typed." {
    include gSummary gClaimsV gMatrixV gBoundV gMcpV gGauntlet
    autolayout lr
}

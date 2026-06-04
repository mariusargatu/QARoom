# One vocabulary, two runtimes (ADR-0005)

Milestone 8 exit criterion 5: *a Screenplay Task authored once is provably executable as a system
test (real page, `BrowseTheWeb`) and a component test (mounted component, `InteractWithComponent`) —
the **same source file** appears in both suites.*

The Task touches the browser only through `actor.withPageProvider().getPage()` (the `PageProvider`
seam), so only the ability binding differs. The Task/Question source lives once in
`packages/testing-utils/src/screenplay/`.

| Task / Question (single source) | Component test (`InteractWithComponent`) | System test (`BrowseTheWeb`) |
|---|---|---|
| `advanceRollout` / `theFlagState` | `organisms/RolloutPanel/RolloutPanel.ct.tsx` | `tests/e2e/rollout.e2e.spec.ts` |
| `castDonation` | `organisms/DonationForm/DonationForm.ct.tsx` | live donation flow (E2E extension — needs the donations stack + flag enabled) |
| `clickTheButton` / `theClickCount` | `atoms/Button/Button.ct.tsx` (broken-atom demo) | atom-level; CT-only by design |

`advanceRollout` is the load-bearing proof: the identical import from
`@qaroom/testing-utils/screenplay` drives a **mounted organism** in the CT and a **real page** in the
MBT-generated E2E. Neither suite hard-codes a selector the other doesn't know — both locate by the
shared `TESTID` contract.

**Why this holds:** a Task that reached for a concrete ability (`BrowseTheWeb`) instead of
`withPageProvider()` would become E2E-bound and silently break the dual-context property. Routing
through the seam is what keeps a `castVote`-style Task authored once, run in both.

# One vocabulary, two runtimes (ADR-0005, narrowed by ADR-0027)

Exit criterion: *a Screenplay Task authored once is provably executable as a system test (real page,
`BrowseTheWeb`) and a component test (rendered component, `InteractWithComponent`): the **same source
file** appears in both suites.*

The Task touches the UI only through `actor.withPageProvider().getDriver()` — the `PageProvider` seam,
narrowed by ADR-0027 to a runtime-agnostic `UiDriver` (`getByTestId → {click,fill,textContent}`) that
both a Playwright `Page` (E2E) and a `vitest-browser` locator (component) satisfy. Only the ability
binding differs. The Task/Question source lives once in `packages/testing-utils/src/screenplay/`.

| Task / Question (single source) | Component test (`InteractWithComponent`, Vitest browser) | System test (`BrowseTheWeb`, Playwright) |
|---|---|---|
| `advanceRollout` / `theFlagState` | `organisms/RolloutPanel/RolloutPanel.browser.test.tsx` | `tests/e2e/rollout.e2e.spec.ts` |
| `castDonation` | `organisms/DonationForm/DonationForm.browser.test.tsx` | live donation flow (E2E extension: needs the donations stack + flag enabled) |
| `clickTheButton` / `theClickCount` | `atoms/Button/Button.browser.test.tsx` (broken-atom demo) | atom-level; component-only by design |

`advanceRollout` is the load-bearing proof: the identical import from
`@qaroom/testing-utils/screenplay` drives a component rendered by `vitest-browser-react` in the
component test and a **real page** in the MBT-generated E2E. Neither suite hard-codes a selector the
other doesn't know; both locate by the shared `TESTID` contract.

**Why this holds:** a Task that reached for a concrete ability (`BrowseTheWeb`) instead of
`withPageProvider()` would become E2E-bound and silently break the dual-context property. Routing
through the seam is what keeps a `castVote`-style Task authored once, run in both.

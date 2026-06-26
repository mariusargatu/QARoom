# ADR 0027: Consolidate frontend component testing on Vitest browser mode

- **Status:** Accepted
- **Date:** 2026-06-25
- **Supersedes:** [ADR-0005](0005-frontend-testing-stack.md) §1–3 and §5 (the Playwright-CT runtime, the `PageProvider.getPage()` seam shape, and the V8+Istanbul coverage merge). ADR-0005's two-runtime *portability* property is kept; only the second runtime changes.
- **Records:** the Milestone-13 collapse of frontend component testing from two browser runtimes (Storybook Test on Vitest browser **and** experimental Playwright Component Tests) onto **one** — Vitest browser mode — plus the 2026 authoring/stack refresh (CSF Factories, `vitest-browser-react`, Vitest visual regression) and the narrowed runtime-agnostic Screenplay seam. Informed by a version sweep of the Storybook/Vitest ecosystem (storybook.js.org, vitest.dev, npm; 2026-06-25). Does **not** modify any ADR-0001 commitment.

## Context

ADR-0005 ran components through **two** real-browser runtimes: Storybook Test (`@storybook/addon-vitest`, Vitest browser) for `play()` + a11y, and **Playwright Component Tests** (`@playwright/experimental-ct-react`) for Screenplay-driven assertions and visual regression. Portable stories (`composeStories`) existed only to share `args` between the two runtimes. The cost of that duplication was structural:

- `@playwright/experimental-ct-react` has been flagged **experimental for years** and its momentum stalled, while **Vitest browser mode graduated** (stable in v4). Pinning a load-bearing tier to an experimental package is a standing risk.
- Two runtimes forced a **two-format coverage merge** — V8 (Vitest) + Istanbul (`vite-plugin-istanbul`) reconciled by `monocart-coverage-reports` — and a bundling-split footgun (`no-mount-composed-story`) that needed its own lint rule.
- The Screenplay seam returned a concrete Playwright `Page`, coupling the "one vocabulary, two runtimes" promise to Playwright specifically.

Meanwhile the 2026 Storybook/Vitest ecosystem offers a cleaner spine: **CSF Factories** (`definePreview`/`meta.story()`, Preview status in Storybook 10.4, React), **`vitest-browser-react`** (real-browser `render()` returning retrying locators), and **Vitest 4 `toMatchScreenshot()`** (stable, local-first pixel visual regression).

## Decision

**1. One component runtime: Vitest browser mode.** Storybook Test (`addon-vitest`) keeps running every story's `play()` + a11y headlessly in Chromium. Hand-written Screenplay component tests run in the **same** Vitest browser runtime via `vitest-browser-react`'s `render()`. **Playwright is reserved for E2E only.** `@playwright/experimental-ct-react`, `vite-plugin-istanbul`, and `monocart-coverage-reports` are removed; coverage is **V8-only** (no cross-format merge) — the Storybook stories run and the Screenplay component run each fold a V8 coverage runner (`coverage` + `coverage:web-component`), so code only the `*.browser.test.tsx` tests exercise is still counted.

**2. The Screenplay seam is narrowed to a runtime-agnostic `UiDriver`.** `PageProvider` no longer returns a Playwright `Page`; it returns `getDriver(): UiDriver`, where `UiDriver.getByTestId(id)` yields the minimal `UiHandle` the Tasks/Questions actually use — `{ click(); fill(value); textContent() }`. A Playwright `Page` (E2E, `BrowseTheWeb`) and a `vitest-browser` locator (component, `InteractWithComponent`) both satisfy it directly. *This* is what makes "the same Task runs in both contexts" true at the type level instead of by Playwright coupling. Tasks still route through `actor.withPageProvider().getDriver()`, never a concrete ability.

**3. Visual regression moves to the Vitest layer, behind a pinned container.** `expect.element(locator).toMatchScreenshot('name')` (Vitest 4, `pixelmatch` comparator, `allowedMismatchedPixelRatio` tolerance, auto-stability retake) replaces Playwright CT's `toHaveScreenshot`. It is **not** a DOM-serialization snapshot, so it does not trip the `no-snapshot` lint ban (the banned set is `toMatch*Snapshot`, not screenshots). Pixel baselines are font/anti-aliasing-sensitive and therefore **not portable across a developer's OS and Linux CI**, so the visual lane runs in ONE pinned container — `services/web/Dockerfile.visual` (Node 24 + the repo's pinned Playwright Chromium + its OS deps/fonts) — used both to GENERATE the committed baseline (`*-chromium-linux.png`) and to CHECK it. `pnpm visual` runs the gate locally; `pnpm visual:update` reseeds; the CI `web-visual` job builds and runs the same image. The visual assertion is opt-in via `VITE_VISUAL=1` (the container sets it), so the default `test:component` lane stays green on any host.

**4. CSF Factories are the authoring format.** `.storybook/{main,preview}` use `defineMain`/`definePreview`; stories migrate to `preview.meta()` + `meta.story()` (backward compatible — classic CSF3 stories keep working, so migration is incremental). `composeStories` still yields typed portable stories (now with `.run()`/`.play()`), reused by the Screenplay component tests.

**5. The composition-delta coverage rule.** Each atomic tier's stories exercise only what that tier *adds*; lower tiers are already proven (an organism story never re-tests the Button inside it). "Coverage" is defined as: every component has a story per meaningful state, interactive components carry a `play()`, visually load-bearing ones carry a `toMatchScreenshot()`, every **rich** page flow is modeled as an invoke-free/context-free XState machine with **100% edge coverage** (`coverageReport`/`assertPathCount`); the rollout flow is additionally replayed E2E via the Screenplay actor (model→runtime conformance), while the newer flow machines (`vote`, `donation-gate`) currently prove model-traversability only — binding them to their live UI via reverse-conformance is a tracked follow-up. Pure logic carries fast-check property tests. Static pages (NotFound, Profile, Moderation) are deliberately **not** modeled as machines.

## Consequences

### Positive

- One browser runtime, one V8 coverage source — the V8+Istanbul merge, `monocart`, `vite-plugin-istanbul`, and the `no-mount-composed-story` footgun/rule all disappear.
- No experimental dependency in a load-bearing tier.
- The Screenplay vocabulary is genuinely runtime-agnostic (a `UiDriver`, not a Playwright `Page`); a `castVote` Task is authored once and runs in component and E2E contexts at the type level.
- `vitest-browser-react` locators retry by default (`expect.element`), removing hand-rolled polling in component tests.

### Negative / trade-offs accepted

- CSF Factories are **Preview** (not yet stable) in Storybook 10.4 and React-only — acceptable here (the web app is React); revisit at Storybook 11.
- Vitest `toMatchScreenshot` baselines are environment-sensitive; visual tests must run in the controlled container to gate, and baselines are committed from that env, not a developer laptop.
- A one-time migration: 4 `.ct.tsx` files are ported to `vitest-browser-react` (the broken-atom, donation-cents, and `useResource` race demos are preserved, not lost), and stories migrate to CSF factories incrementally.

## Rejected alternatives

- **Keep both runtimes (status quo).** Retains an experimental dependency, a second runtime, and the two-format coverage merge for no property the single runtime lacks.
- **Make Playwright CT the one runtime, drop Storybook Test.** Bets everything on the experimental runtime and loses the headless a11y-on-`play()` integration.
- **Chromatic / Applitools for visual regression.** SaaS, against the all-local/no-cloud-index discipline; Vitest `toMatchScreenshot` is local-first and free.
- **React Testing Library in jsdom for component tests.** Loses real-browser fidelity (layout, focus, visual) that the atomic-design library demo exists to show.

## Related decisions

- [ADR-0005](0005-frontend-testing-stack.md) (superseded in part; the MBT generation constraints — invoke-free/context-free machines, `allowDuplicatePaths`, value-only `serializeState`, path-count floor+cap — carry over unchanged).
- `AGENTS.md` "Milestone awareness"; `ARCHITECTURE.md` §3 (Component + Model-based E2E layers).
- Sibling: [ADR-0016](0016-testing-your-tests.md) (the load/mutation/fuzz half of Milestone 8).

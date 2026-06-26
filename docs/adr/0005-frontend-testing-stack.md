# ADR 0005: Frontend testing stack: Storybook + Playwright CT + Screenplay + XState MBT

- **Status:** Accepted — partly superseded by [ADR-0027](0027-consolidate-frontend-component-testing-on-vitest-browser.md)
- **Date:** 2026-05-30
- **Records:** the frontend testing architecture for Milestone 5 (web, model-based E2E, Screenplay foundation) and Milestone 8 (Storybook + component testing). Realizes "testability as an architectural property" for the UI. Informed by a real-world implementation of this exact stack and a version sweep (npm registry, 2026-05-30). Does **not** modify any ADR-0001 commitment.
- **Superseded in part (2026-06-25, ADR-0027):** §1–3 and §5 describe a **two-runtime** component tier (Storybook Test on Vitest browser **plus** experimental Playwright CT), the `PageProvider.getPage()` seam returning a Playwright `Page`, and a V8+Istanbul coverage merge. ADR-0027 collapses component testing onto **one** runtime (Vitest browser mode), narrows the seam to a runtime-agnostic `UiDriver`, moves visual regression to Vitest `toMatchScreenshot`, and adopts CSF Factories + `vitest-browser-react`. The MBT-generation constraints below (invoke-free/context-free machines, `allowDuplicatePaths`, value-only `serializeState`, path-count floor+cap) carry over unchanged. Read this ADR for the *why* of model-based UI testing; read ADR-0027 for the current runtime.

## Context

The web frontend and its tests need a stack. The naive choice (React Testing Library per component, hand-written E2E) misses two categorical UI failures: visual regressions and sequence-dependent state bugs. The decision is to make the **component story the single source of truth** and fan it across the pyramid, joined to model-based E2E by one shared Screenplay vocabulary. Several of the load-bearing details are non-obvious and version-sensitive, which is why they are recorded rather than left to discovery.

## Decision

**1. The story is the source of truth.** Each component ships `Component.stories.tsx` declaring `args` per state, which feed: Storybook autodocs + `addon-a11y` + `play()` interaction tests; Playwright Component Tests (visual regression); and Screenplay-driven assertions.

**2. The spine: one vocabulary, two runtimes.** XState model -> Screenplay Task -> `PageProvider.getPage()` seam -> Playwright. The same Task source runs as E2E (`BrowseTheWeb`) or component test (`InteractWithComponent`); only the ability binding changes.

**3. The load-bearing constraints** (each a footgun discovered the hard way):
- **Model machines are flattened, context-free, and free of `invoke` / `after` / delayed actions**: `@xstate/graph` 3 throws "Invocations on test machines are not supported", and `context` explodes the BFS. Async/timer boundaries are modeled as explicit events. A regression test pins this.
- **MBT generation:** `createTestModel(model).getShortestPaths({ allowDuplicatePaths: true, serializeState: s => JSON.stringify(s.value) })` (PR CI) / `.getSimplePaths(...)` (nightly). `allowDuplicatePaths` is mandatory (default dedup silently shrinks coverage); value-only `serializeState` keeps the model context-free. A path-count **floor and cap** both gate CI. `getShortestPathPlans`/`getSimplePathPlans` are the removed XState-v4 API.
- **Playwright CT mounts the raw component spread with `story.args`**, using `composeStories` only to *read* args: a `composeStories()` result cannot be `mount()`-ed in CT ("Component cannot be mounted"). Lint-enforced.
- **Screenplay Tasks route through `withPageProvider()`**, never a concrete ability, or they become E2E-bound and break the dual-context property.
- **Storybook 10 is ESM-only**; `play()` functions import from `storybook/test` (not `@storybook/test`) and run headlessly via `@storybook/addon-vitest`.
- **Coverage** merges V8 (Vitest) + Istanbul (Playwright CT) via `monocart-coverage-reports` (a plain `nyc merge` cannot mix the two), feeding `test-results/summary.json`.

**4. The web frontend is a real atomic-design library** (`atoms -> … -> pages`, semantic `--color-*` tokens, Tailwind 4 CSS-first `@theme`, thin `ThemeProvider`), not a placeholder. **Test data uses fast-check** generators (the repo standard), not a separate factory library.

**5. Pinned stack** (npm `latest`, verified 2026-05-30):

| Area | Packages |
|---|---|
| State + MBT | `xstate@5.32`, `@xstate/graph@3.0.4` (**exact**: invoke-rejection + traversal options are undocumented internals), `@xstate/react@6.1` |
| Stories | `storybook@10.4`, `@storybook/react-vite@10.4`, `@storybook/addon-vitest@10.4`, `@storybook/addon-a11y@10.4` |
| Component / E2E | `@playwright/test@1.60`, `@playwright/experimental-ct-react@1.60` (still "experimental"; lock to the exact `@playwright/test` version), `@axe-core/playwright@4.11` |
| Runner / coverage | `vitest@4.1` (v4: `projects`, not `workspace`), `@vitest/coverage-v8@4.1`, `vite-plugin-istanbul@9.0`, `monocart-coverage-reports@2.12` |
| Build / style | `vite`, `@vitejs/plugin-react@6.0`, `tailwindcss@4.3`, `@tailwindcss/vite@4.3` |
| Mocking / data | `msw@2.14`, `fast-check@4.8` |

## Consequences

### Positive

- One Screenplay vocabulary spans component and system tests; a `castVote` Task is authored once, run in both.
- The frontend is a genuine component library, so the demo looks like a real project.
- All-local, deterministic, no embedding index; fits the determinism discipline.

### Negative / trade-offs accepted

- Version-sensitive: `@xstate/graph` is pinned **exact** because the constraints are undocumented internals.
- Storybook 10 is ESM-only (`.storybook/main` must be ESM); Vitest 4 rewrote V8 coverage (re-baseline the 80% gate); Playwright CT is still `experimental-ct-react`.
- The CT "raw mount, not the composed story" rule is a footgun that needs a lint rule to stay enforced.

## Rejected alternatives

- **React Testing Library only** (no visual regression, no MBT). Misses pixel and sequence-dependent bugs, the two categorical UI failures this stack exists to catch.
- **Mounting the `composeStories()` result in CT.** Does not work (Node↔browser bundling split).
- **Separate, parallel test stacks per layer.** Loses the one-vocabulary property that makes a Task reusable across CT and E2E.
- **A factory library (e.g. fishery) for test data.** QARoom already standardizes on fast-check; a second data-generation paradigm earns nothing.
- **Next.js for the frontend.** React + Vite aligns with Storybook/CT/Vitest 4; Next adds a server runtime the demo does not need.

## Related decisions

- `AGENTS.md` "Milestone awareness": Milestone 5 (MBT + Screenplay + atomic frontend) and Milestone 8 (Storybook + CT).
- `ARCHITECTURE.md` §3 (Component + Model-based E2E layers in the honeycomb), `ARCHITECTURE.md` (testability-as-architecture).
- Sibling ADRs: [ADR-0003](0003-websocket-mock-strategy.md) (WS), [ADR-0004](0004-code-intelligence-stack.md), [ADR-0016](0016-testing-your-tests.md) (the load/mutation/fuzz half of Milestone 8).

## Implementation notes (Milestone 8, 2026-06-04)

Implementing the pinned stack against the live registry surfaced corrections to the table above,
recorded here rather than rewriting the decision:

- **Add `@vitest/browser-playwright@4.1.8`.** Vitest 4 extracted the Playwright browser provider into
  this package; `@storybook/addon-vitest@10.4` peer-depends on it. It was missing from the pin table.
- **`provider` is the function `playwright()`** imported from `@vitest/browser-playwright`, **not the
  string `'playwright'`**: the string is the Vitest-3/Storybook-9 form.
- **No hand-authored `.storybook/vitest.setup.ts`.** Storybook 10's `@storybook/addon-vitest`
  auto-injects its own `setProjectAnnotations` setup; a manual file logs "you can safely remove." The
  file was deleted.
- **vite is pinned to `^7`, `@vitejs/plugin-react` to `^5.2`** (not vite 8 / plugin-react 6): the
  pinned `@playwright/experimental-ct-react@1.60` caps the workspace vite at 7, and vite 7 satisfies
  storybook 10.4 + vitest 4.1. `tailwindcss`/`@tailwindcss/vite` -> `4.3`.
- **`vite-plugin-istanbul` is pinned `^8`, not `^9`** (corrects the table above): the CT coverage
  instrument is injected into the vite that Playwright CT **bundles internally (vite 6)**, not the
  workspace vite 7. istanbul@9 peers `vite >=7`, so it would be unsatisfied on that path; istanbul@8
  peers `vite >=4` and covers it cleanly.
- **Playwright CT mounts STATIC JSX**, not `createElement(...)`. CT's transform rejects a
  runtime-built element ("Object mount notation is not supported"), so each `.ct.tsx` does
  `mount(<Component {...story.args} />)` and the `readyFonts` helper (`src/test-support/ready-fonts.ts`)
  only awaits `document.fonts.ready`.
  This is still "raw component spread with story.args": the `no-mount-composed-story` rule holds.
- **Vitest 4 V8 coverage** requires an explicit `coverage.include` (the default now reports only
  covered files), aggregates at the **root** config (not per-project), and remaps differently, so the
  browser-tier coverage is **reported, not gated at 80%**: story+CT coverage of a 14-component library
  is naturally partial, and the merged V8+Istanbul report (`coverage/merged`, via `monocart.add()`)
  feeds `summary.json` as an artifact, not a hard threshold.
- **A real a11y find:** turning on `parameters.a11y.test: 'error'` exposed pre-existing WCAG-AA
  contrast failures on the single `--color-danger` token (white-on-danger and danger-on-subtle pull
  opposite ways). Split into `--color-danger` (bright accent) + `--color-danger-solid` (dark fill);
  `Button` danger now uses `bg-danger-solid`.

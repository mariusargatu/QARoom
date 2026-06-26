# web

The React + Vite frontend (Milestone 5, extended to the full platform UI post-ADR-0022): a
**real atomic-design component library** + pages for the feed, posts, donations, flag rollouts,
identity/communities/members, webhooks, and the moderation dashboard, all against the gateway
edge. It is the substrate the Milestone-8 component tests exercise, not a placeholder. Read the
repo-root `AGENTS.md` first, then `docs/atomic-structure.md` here.

## Structure (import direction is downward only)

`atoms -> molecules -> organisms -> templates -> pages`. Folder-per-component: `Component.tsx`
(`forwardRef` + `displayName`) + one-line named-export `index.ts` + `Component.stories.tsx` +
`Component.browser.test.tsx` (Screenplay component test, ADR-0027) for load-bearing components.
Styling is **exclusively** semantic design tokens
(`bg-surface`, `text-muted`, `text-primary`, …) defined in `src/styles/globals.css` via the
Tailwind 4 CSS-first `@theme` block: no `tailwind.config.js`, no hex literals. The thin
`ThemeProvider` toggles only the `.light` class.

## Where things live

- **Tokens:** `src/styles/globals.css` (dark `:root`, light `.light`).
- **Hooks:** `src/hooks/`: `useRollout` (legal events read from the SAME XState rollout machine
  the server drives), `useDonations`, `useWsWithPollingFallback` (polling path; Commitment 11).
- **Clients:** `src/api/client.ts` (gateway; idempotency keys from a COUNTER: no `Date.now()`/
  `crypto.randomUUID()`, the determinism lint applies to browser `.ts` too), `src/ws/client.ts`.
- **Test ids:** shared from `@qaroom/testing-utils/testids` so components and Screenplay Tasks
  agree on selectors.

## Testing

- **Vitest** (`pnpm --filter @qaroom/web test`): api client + pure helpers (node env).
- **Storybook (CSF Factories, ADR-0027)**: every atom/molecule/organism has a story (the source of
  truth); authored with `preview.meta()` + `meta.story()` (classic CSF3 still works — migration is
  incremental); `addon-a11y`. Stories with `play()` interaction tests are whichever
  `grep -rl "play:" src --include="*.stories.tsx"` lists (no hand-maintained count); they run
  headlessly via `@storybook/addon-vitest` (`pnpm --filter @qaroom/web test:stories`, real Chromium).
- **Screenplay component tests** (`.browser.test.tsx`, ADR-0027 — supersedes Playwright CT): render
  with `vitest-browser-react`'s `await render(...)` and drive the component through the SAME
  Screenplay Tasks/Questions the E2E suite uses, via `createComponentActor`
  (`@qaroom/testing-utils/screenplay-ct` -> `InteractWithComponent`). Reuse a portable CSF-factory
  story with `Story.Component` (`render(<OffState.Component onAdvance={spy} />)`). Run with
  `pnpm --filter @qaroom/web test:component` (real Chromium). One browser runtime, no Playwright CT.
- **Visual regression** (ADR-0027 §3): Vitest `expect.element(locator).toMatchScreenshot()` (pixel
  diff, NOT a DOM snapshot — does not trip `no-snapshot`). OPT-IN via `VITE_VISUAL=1` because pixel
  baselines are environment-named and not portable across a laptop OS and the CI container; the
  canonical baseline is committed from the container (`__screenshots__/` is gitignored).
- **MBT E2E** (`tests/e2e/`): Screenplay flows generated from the rollout model; the SAME Tasks
  (`advanceRollout`/`theFlagState`) run in the component tests (above) and E2E via `BrowseTheWeb`,
  both behind the narrowed `PageProvider`/`UiDriver` seam. Needs a browser + live stack.
- **Coverage**: one V8 source from the Storybook/Vitest browser run (`test:stories:coverage` ->
  `coverage/`); no V8+Istanbul merge.
- **Lint-enforced**: `qaroom/atomic-import-direction` (tiers flow downward only) on every `.tsx`.

## Commands

```bash
pnpm --filter @qaroom/web dev        # vite dev server
pnpm --filter @qaroom/web build      # tsc + vite build
pnpm --filter @qaroom/web typecheck
pnpm --filter @qaroom/web test       # vitest (unit project, node)
pnpm --filter @qaroom/web test:stories # headless story play() + a11y (real Chromium)
pnpm --filter @qaroom/web test:component # Screenplay component tests (Vitest browser, ADR-0027)
pnpm --filter @qaroom/web storybook  # storybook dev (browser)
pnpm --filter @qaroom/web e2e        # playwright MBT e2e (browser + live stack)
pnpm --filter @qaroom/web test:stories:coverage # single V8 coverage source
# VITE_VISUAL=1 pnpm --filter @qaroom/web test:component  # opt-in pixel visual regression
```

## Stack note

The stack (ADR-0005, consolidated by ADR-0027): Storybook 10.4 (CSF Factories) / Vitest 4.1
(`projects`, not `workspace`) / `@vitest/browser` + `@vitest/browser-playwright` 4.1 /
`vitest-browser-react` 2.2 / Playwright 1.60 (E2E only) / Tailwind 4.3 / React 19 / Vite 7 /
`@vitejs/plugin-react` 5.2. Three test surfaces, all Vitest: the `unit` project (`pnpm test`, node),
the headless `storybook` project (`pnpm test:stories`, real Chromium, play() + addon-a11y set to FAIL
on a violation), and the `component` project (`pnpm test:component`, real Chromium, Screenplay +
`vitest-browser-react`). Playwright is E2E-only. See ADR-0027 for why the second browser runtime
(Playwright CT) was removed and how the `PageProvider`/`UiDriver` seam stays portable across both.

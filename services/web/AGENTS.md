# web

The React + Vite frontend (Milestone 5, extended to the full platform UI post-ADR-0022): a
**real atomic-design component library** + pages for the feed, posts, donations, flag rollouts,
identity/communities/members, webhooks, and the moderation dashboard, all against the gateway
edge. It is the substrate the Milestone-8 component tests exercise, not a placeholder. Read the
repo-root `AGENTS.md` first, then `docs/atomic-structure.md` here.

## Structure (import direction is downward only)

`atoms -> molecules -> organisms -> templates -> pages`. Folder-per-component: `Component.tsx`
(`forwardRef` + `displayName`) + one-line named-export `index.ts` + `Component.stories.tsx` +
`Component.ct.tsx` for load-bearing components. Styling is **exclusively** semantic design tokens
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
- **Storybook**: every atom/molecule/organism has a story (the source of truth); `addon-a11y`.
  Stories with `play()` interaction tests are whichever
  `grep -rl "play:" src --include="*.stories.tsx"` lists (no hand-maintained count); they run
  headlessly via `@storybook/addon-vitest` (`pnpm --filter @qaroom/web test:stories`, real
  Chromium, M8).
- **Playwright CT** (`.ct.tsx`): mounts the **raw component spread as static JSX**
  `mount(<Component {...story.args} />)` (a runtime `createElement` is rejected by CT); reads args
  with `composeStories`, never `mount()`s the composed story, enforced by the
  `qaroom/no-mount-composed-story` lint rule (ADR-0005). The `readyFonts` helper
  (`src/test-support/ready-fonts.ts`) awaits `document.fonts.ready` for stable visuals.
  `RolloutPanel.ct.tsx`/`Button.ct.tsx`/`DonationForm.ct.tsx` are the examples.
- **MBT E2E** (`tests/e2e/`): Screenplay flows generated from the rollout model; the SAME Tasks
  (`advanceRollout`/`theFlagState`) run in CT via `createComponentActor`
  (`@qaroom/testing-utils/screenplay-ct` -> `InteractWithComponent`) and E2E via `BrowseTheWeb`,
  both behind the `PageProvider` seam. Needs a browser + live stack.
- **Unified coverage** (M8): CT Istanbul (`ct:coverage` -> `.nyc_output/`) + Vitest V8 reconciled
  by `scripts/merge-coverage.ts` (monocart) -> `coverage/merged/`.
- **Lint-enforced**: `qaroom/atomic-import-direction` (tiers flow downward only) on every `.tsx`;
  `qaroom/no-mount-composed-story` on `.ct.tsx`.

## Commands

```bash
pnpm --filter @qaroom/web dev        # vite dev server
pnpm --filter @qaroom/web build      # tsc + vite build
pnpm --filter @qaroom/web typecheck
pnpm --filter @qaroom/web test       # vitest (unit project, node)
pnpm --filter @qaroom/web test:stories # headless story play() + a11y (real Chromium)
pnpm --filter @qaroom/web storybook  # storybook dev (browser)
pnpm --filter @qaroom/web ct         # playwright component tests (browser)
pnpm --filter @qaroom/web ct:coverage # CT with Istanbul instrumentation (browser)
pnpm --filter @qaroom/web e2e        # playwright MBT e2e (browser + live stack)
pnpm --filter @qaroom/web coverage:merge # monocart: merge Vitest V8 + CT Istanbul
```

## Stack note

The ADR-0005 stack is installed (Milestone 8): Storybook 10.4 / Vitest 4.1 (`projects`, not
`workspace`) / Playwright 1.60 (CT, pinned) / `@vitest/browser-playwright` 4.1 / Tailwind 4.3 /
React 19 / Vite 7 (capped by Playwright CT) / `@vitejs/plugin-react` 5.2. Tests split into the
`unit` Vitest project (`pnpm test`, node), the headless `storybook` project (`pnpm test:stories`,
real Chromium, play() + addon-a11y, which is set to FAIL on a violation), and Playwright CT
(`pnpm ct`). See ADR-0005 "Implementation notes (Milestone 8)" for the upgrade corrections
(provider `playwright()`, no manual `vitest.setup.ts`, static-JSX CT mounts).

# Web frontend — atomic structure

The web frontend is a **real atomic-design component library** (ADR-0005), not a placeholder.
Each tier imports only the tiers below it; styling is **exclusively** through semantic design
tokens. This is the substrate the Milestone-8 component tests exercise.

## Tiers (import direction is downward only)

```
pages        CommunityDashboardPage              — composition root; wires hooks → organisms
  └ templates  DashboardTemplate                 — pure layout, named slots, no data
      └ organisms  RolloutPanel, DonationForm,    — feature sections
                   DonationList, NotificationFeed
          └ molecules  RolloutStepper,            — small compositions of atoms
                       DonationAmountField
              └ atoms  Button, Badge, Spinner     — primitives, token-styled
```

## Folder-per-component

Every component lives in its own folder with:

- `Component.tsx` — `forwardRef` + `displayName`, styled only via semantic-token utilities.
- `index.ts` — a one-line named-export barrel (no `export *`; the `qaroom/no-public-barrel` rule).
- `Component.stories.tsx` — Storybook stories declaring `args` per state (the source of truth).
- `Component.ct.tsx` — Playwright Component Test (for the load-bearing components).

## Semantic tokens (no raw colours)

`src/styles/globals.css` defines `--color-*` tokens surfaced as Tailwind 4 utilities via the
CSS-first `@theme` block (no `tailwind.config.js`). Dark is the `:root` default; `.light` flips
the same tokens. The thin `ThemeProvider` toggles only the `.light` class and holds no styles.
Components use utilities like `bg-surface`, `text-muted`, `border-border`, `text-primary` — never
hex literals — so a theme is a token remap, not a component rewrite.

## Testing seams

- **Stories** feed Storybook autodocs + `addon-a11y` + a `play()` interaction test (run headlessly
  via `@storybook/addon-vitest`, M8), and are READ (via `composeStories`) by the Playwright CTs,
  which **mount the raw component spread as static JSX** `mount(<Component {...story.args} />)` (then
  await the `readyFonts` helper, `src/test-support/ready-fonts.ts`) — a `composeStories()` result
  cannot be `mount()`-ed, nor can a runtime `createElement` (the Node↔browser split; ADR-0005), and
  the `qaroom/no-mount-composed-story` lint rule enforces it.
- **Screenplay** (`@qaroom/testing-utils/screenplay`) Tasks/Questions touch the browser only
  through `actor.withPageProvider().getPage()`, so the same `advanceRollout` / `theFlagState`
  source runs as an E2E test (`BrowseTheWeb`) and a component test. The CT→Actor bridge is
  `createComponentActor(mountResult)` from `@qaroom/testing-utils/screenplay-ct` (the M8 package —
  the only one importing `@playwright/experimental-ct-react`), binding `InteractWithComponent`.
- **Test ids** are shared from `@qaroom/testing-utils/testids` (`TESTID`), so components and
  Tasks agree on selectors.
- **MBT E2E** (`tests/e2e/rollout.e2e.spec.ts`) generates Screenplay flows from the XState
  rollout model — the same model the flags-service conformance test replays.
- **Lint-enforced direction** — `qaroom/atomic-import-direction` fails any `.tsx` that imports
  from a higher tier (atoms ← molecules ← organisms ← templates ← pages).
- **Unified coverage** (M8) — `scripts/merge-coverage.ts` reconciles Vitest V8 + CT Istanbul
  (`COVERAGE=true ct:coverage` → `.nyc_output/`) via `monocart-coverage-reports`.

## Stack note

The pinned target stack is ADR-0005 (Storybook 10 / Playwright 1.60 / Vitest 4 / Tailwind 4).
This package resolves to the latest installable equivalents in the build environment
(Storybook 9 / Playwright 1.60 / Vitest 3 / Tailwind 4, React 19, Vite 6); the patterns are
identical and the deviation is recorded here. Component/E2E suites + headless `play()` + the
coverage merge require a browser and are run with `pnpm --filter @qaroom/web ct` / `e2e` /
`ct:coverage` / `coverage:merge` where Playwright browsers are installed.

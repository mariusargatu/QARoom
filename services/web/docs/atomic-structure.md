# Web frontend: atomic structure

The web frontend is a **real atomic-design component library** (ADR-0005), not a placeholder.
Each tier imports only the tiers below it; styling is **exclusively** through semantic design
tokens. This is the substrate the Milestone-8 component tests exercise.

## Tiers (import direction is downward only)

Each tier's members live in `src/components/<tier>/` — run `ls` there for the current roster instead
of trusting a hand-copied list (which drifts every milestone). What each tier *is*, top to bottom:

- **pages** (`ls src/components/pages/`) — one composition root per route; wire hooks/session →
  organisms. Controllers, not reusable; no stories.
- **templates** (`ls src/components/templates/`) — pure layout, named slots, no data. `AppShell` is the
  authenticated frame: a slim top masthead over a **single centered reading column** — no left sidebar
  (explicitly rejected, DESIGN.md "Warm Commons"); navigation lives in the masthead's own dropdowns.
- **organisms** (`ls src/components/organisms/`) — feature sections: the masthead, forms, lists, panels.
- **molecules** (`ls src/components/molecules/`) — small compositions (form fields, tabs, empty/error states).
- **atoms** (`ls src/components/atoms/`) — token-styled primitives (buttons, inputs, badges, …).

The full consumer + operator surface (Milestone 14, the deferred frontend slot) is built on this
library and backed by the gateway's identity + moderation passthrough (ADR-0022). Same-tier imports
are allowed; only importing a *higher* tier is a lint error.

## App wiring (outside the tiers)

- **`src/routes/`** — the router (`AppRoutes`) + route wrappers (`RequireSession`, `AppShellRoute`,
  `CommunityLayout`). `react-router-dom` v7.
- **`src/session/`** — `SessionProvider` + `useSession` (the demo identity: pick/create a user →
  mint a session JWT; no passwords, ADR-0022) and `jwt.ts` (decode claims for nav, unverified).
- **`src/api/`** — `http.ts` (fetch core: counter idempotency keys, bearer for the WS-ticket mint,
  RFC 7807 → typed `ApiError`), `client.ts` (the full `ApiClient`, every response Zod-parsed),
  `ApiProvider`/`useApi`.
- **`src/hooks/`** — one data hook per surface (`useFeed`, `usePost`, `useVote`, `useMembers`,
  `useWebhooks`, `useModeration`, `useFlagsList`, `useWsConnector`, + the existing rollout/donation/
  activity hooks). **`src/lib/`** — pure helpers (`format`, `errors`, `rollout`).

## Folder-per-component

Every component lives in its own folder with:

- `Component.tsx`: `forwardRef` + `displayName`, styled only via semantic-token utilities.
- `index.ts`: a one-line named-export barrel (no `export *`; the `qaroom/no-public-barrel` rule).
- `Component.stories.tsx`: CSF-factory Storybook stories declaring `args` per state (the source of truth).
- `Component.browser.test.tsx`: Screenplay component test in Vitest browser mode (most components, ADR-0027).

## Semantic tokens (no raw colours)

`src/styles/globals.css` defines `--color-*` tokens surfaced as Tailwind 4 utilities via the
CSS-first `@theme` block (no `tailwind.config.js`). Dark is the `:root` default; `.light` flips
the same tokens. The thin `ThemeProvider` toggles only the `.light` class and holds no styles.
Components use utilities like `bg-surface`, `text-muted`, `border-border`, `text-primary`, never
hex literals, so a theme is a token remap, not a component rewrite.

## Testing seams

- **Stories** (CSF Factories, ADR-0027) feed Storybook autodocs + `addon-a11y` + a `play()`
  interaction test (run headlessly via `@storybook/addon-vitest`), and are REUSED as portable stories
  in the component tests via `Story.Component` (`render(<OffState.Component onAdvance={spy} />)`).
- **Screenplay** (`@qaroom/testing-utils/screenplay`) Tasks/Questions touch the UI only through
  `actor.withPageProvider().getDriver()` (a runtime-agnostic `UiDriver`), so the same `advanceRollout`
  / `theFlagState` source runs as an E2E test (`BrowseTheWeb`, a Playwright `Page`) and a component
  test (`InteractWithComponent`, a `vitest-browser` locator). The component→Actor bridge is
  `createComponentActor(renderResult)` from `@qaroom/testing-utils/screenplay-ct`, which adapts a
  `vitest-browser-react` `render()` result; the package imports no browser runner (ADR-0027).
- **Test ids** are shared from `@qaroom/testing-utils/testids` (`TESTID`), so components and
  Tasks agree on selectors.
- **MBT E2E** (`tests/e2e/rollout.e2e.spec.ts`) generates Screenplay flows from the XState
  rollout model, the same model the flags-service conformance test replays.
- **Lint-enforced direction**: `qaroom/atomic-import-direction` fails any `.tsx` that imports
  from a higher tier (atoms ← molecules ← organisms ← templates ← pages).
- **Coverage**: one V8 source from the Storybook/Vitest browser run (`test:stories:coverage`);
  no V8+Istanbul merge (ADR-0027).
- **Visual regression**: Vitest `toMatchScreenshot` (opt-in `VITE_VISUAL=1`; baselines gitignored,
  committed from the CI container — ADR-0027 §3).

## Stack note

The stack is ADR-0005 as consolidated by ADR-0027: Storybook 10 (CSF Factories) / Vitest 4 +
`@vitest/browser` + `vitest-browser-react` / Playwright 1.60 (E2E only) / Tailwind 4 / React 19 /
Vite 7. Component testing runs in ONE browser runtime (Vitest browser mode); Playwright CT was
removed. The three suites — node `test`, headless `test:stories` (play() + a11y), and
`test:component` (Screenplay) — require a browser for the latter two and are run with
`pnpm --filter @qaroom/web test:stories` / `test:component` / `e2e` where Chromium is installed.

import parser from '@typescript-eslint/parser'
import qaroom from 'eslint-plugin-qaroom'

const tsLang = {
  parser,
  parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
}

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/coverage-component/**',
      'test-results/**',
      '**/*.gen.ts',
      '**/openapi.yaml',
      '**/migrations/**',
      // EvoMaster-generated black-box test suites (Milestone 8): `// @generated`, JS_JEST output,
      // regenerated each nightly run — review artifacts, never hand-edited, line-limit exempt.
      '**/evomaster-generated/**',
    ],
  },
  // Production source: determinism + structural rules. Tests excluded (see next block).
  {
    files: ['**/*.ts'],
    ignores: [
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/*.property.test.ts',
      '**/tests/**',
      '**/*.config.ts',
      '**/*.setup.ts',
    ],
    languageOptions: tsLang,
    plugins: { qaroom },
    rules: {
      'qaroom/no-new-date': 'error',
      'qaroom/no-unseeded-random': 'error',
      'qaroom/no-public-barrel': 'error',
      'qaroom/no-raw-nats-subject': 'error',
      'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
    },
  },
  // The determinism production impls + their seeded test doubles are the sanctioned
  // homes for Date/crypto/PRNG primitives. Build/CI scripts are tooling, not the
  // deterministic runtime, so they are exempt too.
  {
    files: [
      'packages/determinism/src/production/**/*.ts',
      'packages/testing-utils/src/determinism/**/*.ts',
      // Build/CI scripts are tooling, not the deterministic runtime — at the repo root and inside any
      // package (e.g. services/web/scripts/ct-results.ts merging coverage into summary.json).
      'scripts/**/*.ts',
      '**/scripts/**/*.ts',
    ],
    rules: {
      'qaroom/no-new-date': 'off',
      'qaroom/no-unseeded-random': 'off',
    },
  },
  // The two governed falsifiable-claim / detection-matrix DATA manifests. Their schema
  // (detection-matrix-schema.ts) and technique classifiers (matrix-classifiers.ts) are already
  // extracted to sibling files; what remains is an append-only ARRAY of governed data — claims and
  // deliberate-bug toggles — each row pinned to THIS exact file by CODEOWNERS + the invariant-guard
  // workflow (both reference the files by path, not a glob). It cannot be decomposed further without
  // FRAGMENTING that single-source governance, so the 500-line cap — whose purpose is to force LOGIC
  // decomposition, already done here — does not serve these data files. Raised, not removed: growth
  // past this still forces a deliberate governance decision (split into a second governed file).
  {
    files: ['scripts/lib/manifests/claims.ts', 'scripts/lib/manifests/detection-matrix.ts'],
    rules: {
      'max-lines': ['error', { max: 650, skipBlankLines: true, skipComments: true }],
    },
  },
  // Tests: shape + discipline rules.
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/*.property.test.ts'],
    languageOptions: tsLang,
    plugins: { qaroom },
    rules: {
      'qaroom/test-name-shape': 'error',
      'qaroom/no-conditional-in-test': 'error',
      'qaroom/no-snapshot': 'error',
      // A strong-sounding title can't guarantee a strong body; this flags an existence/truthiness-only
      // oracle. Complements test-name-shape (which only sees the title).
      'qaroom/no-weak-only-assertion': 'error',
      // Lock the by-convention determinism discipline into tests too — but keep the fixed-arg literal
      // (`new Date('2026-…')`); only the wall-clock `new Date()` / `Date.now()` (the flake source) reds.
      // The determinism-sanctioned homes + scripts are re-exempted in the block just below.
      'qaroom/no-new-date': ['error', { allowArgs: true }],
      'qaroom/no-unseeded-random': 'error',
      'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
    },
  },
  // Re-assert the determinism exemption AFTER the tests block so it wins for the sanctioned test homes:
  // the system-clock production test legitimately reads `Date.now()` to check the wrapper, script tests
  // are tooling, and the live golden-journey e2e needs a wall-clock run suffix for cross-run uniqueness
  // (a seeded id would repeat and collide across separate `pnpm journey:run` invocations — not an
  // assertion, so no determinism risk). (Mirrors the production-source exemption above; later-wins.)
  {
    files: [
      'packages/determinism/src/production/**/*.ts',
      'packages/testing-utils/src/determinism/**/*.ts',
      'scripts/**/*.ts',
      '**/scripts/**/*.ts',
      // Journey TEST files only (`*.test.ts`) — narrowing to `.test.ts` keeps this from broadening what
      // eslint lints (a bare `**/*.ts` here pulls non-test journey helpers in under the default parser).
      'tests/journey/**/*.test.ts',
    ],
    rules: {
      'qaroom/no-new-date': 'off',
      'qaroom/no-unseeded-random': 'off',
    },
  },
  // Frontend (.tsx): atomic-design dependency direction (ADR-0005). The determinism rules
  // deliberately do NOT run here — browser `.ts` files carry those; `.tsx` is JSX-only.
  {
    files: ['**/*.tsx'],
    languageOptions: {
      parser,
      parserOptions: { ecmaVersion: 2023, sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    plugins: { qaroom },
    rules: {
      'qaroom/atomic-import-direction': 'error',
    },
  },
  // k6 load scripts (Milestone 8): plain ESM .js with goja globals. The determinism guardrails apply
  // here too — k6 scripts must not reach for raw Date/Math.random (use __VU/__ITER for variation).
  {
    files: ['load-tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { __ENV: 'readonly', __VU: 'readonly', __ITER: 'readonly', open: 'readonly' },
    },
    plugins: { qaroom },
    rules: {
      'qaroom/no-new-date': 'error',
      'qaroom/no-unseeded-random': 'error',
    },
  },
]

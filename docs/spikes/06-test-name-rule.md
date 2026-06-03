# Spike 6 — Test-name lint rule

- **Milestone affected:** 0 (and ongoing)
- **Question:** Can a lint rule enforce the test-name-shape convention (titles describe
  the property/invariant, not `vote() works` / `happy path`) with a low false-positive rate?
- **Verdict:** ✅ **PASS**

## Method

Implemented `qaroom/test-name-shape` in `tools/eslint-plugin-qaroom`. It inspects
`it` / `test` / `describe` calls with a string-literal title and flags:
- function-call style (`/\w+\(\)/`, e.g. `"vote() works"`),
- low-signal phrases (`works`, `happy path`, `basic test`, `returns correctly`, `should work`, `smoke`, `test`),
- single-word `it`/`test` titles (too terse). `describe` may be a noun label.

## Result

Validated with ESLint `RuleTester` (part of the 23/23 plugin suite): bad titles
(`"works"`, `"vote() works"`, `"happy path"`, `"returns"`) are flagged; good titles
(`"voting on a deleted post returns 410 with the deletion problem-details"`) and noun
`describe` labels pass. No false positives observed across the existing test suite
(64 tests) — the rule is active in `eslint.config.js` for `*.test.ts` / `*.spec.ts` /
`*.property.test.ts` and CI is green.

## Consequence

Enforced in CI as `error` (not downgraded to warning). The fallback (lint-warning +
review) is not needed. No ADR amendment.

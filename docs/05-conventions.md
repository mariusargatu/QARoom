# Conventions — folded (enforced, not written)

> Folded in the Living-Documentation pass. Conventions are **enforced, not documented**, so the rules live where they run:

- **The lint rules:** [`tools/eslint-plugin-qaroom`](../tools/eslint-plugin-qaroom) + Biome (no `new Date()`/`Math.random()` in non-test code, no `toMatchSnapshot`, no conditional logic in tests, no raw NATS subjects, file-length, etc.).
- **The drift gates:** `pnpm claims:verify` / `boundaries:render` / `cost:render` / `matrix:verify` / `tour:verify` / `openapi:verify` / `asyncapi:verify` / `mcp:verify` / `census`.
- **The human summary:** [`AGENTS.md`](../AGENTS.md) → "Conventions you must follow".
- **The contracts:** Zod in `packages/contracts/`; RFC 7807 in `packages/contracts/src/errors.ts`; subject grammar in `packages/contracts/src/subjects.ts`.

The one-page landscape is [`ARCHITECTURE.md`](../ARCHITECTURE.md).

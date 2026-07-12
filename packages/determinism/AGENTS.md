# determinism

The injectable `Clock` / `IdGenerator` / `Randomness` trio (Commitment 6). Business logic reads
**only** these interfaces — never a global `new Date()`, `Math.random()`, or unseeded UUID. Read the
repo-root `AGENTS.md` first.

## What lives here

- **`types.ts`**: the three interfaces — the contract every service depends on. `Clock.now()` is
  logical time (TTLs/expiries), `IdGenerator.next(prefix)` emits `<prefix>_<ULID>` strings the
  branded parsers in `@qaroom/contracts` validate at the boundary, `Randomness` is seedable.
- **`production/`**: the real implementations wired by production boot. `SystemClock` is the ONE
  sanctioned `new Date()` site; `UlidIdGenerator` wraps `ulid`; `CryptoRandomness` is CSPRNG-backed.
  `FixedClock` is the replay clock (Commitment 8) — a service booted in snapshot-replay pins it from
  the bundle's `clock_seed`. `clock-bridge.ts` (`unixSeconds`/`dateFromEpochMillis`) is the immutable
  seconds↔`Date` escape hatch, and the only reason `production/` is exempt from the `new Date` fence.

## Conventions enforced here

- **Production wires real, tests wire seeded.** The seeded doubles (`FakeClock`, `SeededIdGenerator`,
  `SeededRandomness`) and their reproducibility tests (same seed ⇒ same sequence, one per double)
  live in `@qaroom/testing-utils`, NOT here. **Production code must never import from testing-utils.**
- **No globals.** Leaking `new Date()` / `Math.random()` / `crypto.randomUUID()` into business code
  is a P0 defect, fenced by `eslint-plugin-qaroom` (`eslint.config.js`). `production/` is the sole
  exempt glob — keep the leak out of every other file. See "Conventions — the gate is the spec" in the
  repo-root `AGENTS.md`.

## Commands

```bash
pnpm --filter @qaroom/determinism test       # vitest (ULID prefix shape + bridge purity)
pnpm --filter @qaroom/determinism typecheck
```

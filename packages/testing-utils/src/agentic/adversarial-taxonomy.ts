import fc from 'fast-check'
import { MUTANTS, tally } from './assertion-teeth'

/**
 * Boundary 16 — agentic development as a tested boundary (ADR-0032), the T23 adversarial-prove surface
 * (ADR-0033). An author-planted mutant is a SELECTION EFFECT: the gate is only proven against the
 * cheat the author imagined. So the `prove --break` mutants must be seeded from the NAMED attack
 * taxonomy that the empirical record measured, not from imagination:
 *
 *   - `equals-true`    `__eq__`→True / assertion-less matcher        (ImpossibleBench, GPT-5 76%)
 *   - `exit-zero`      `sys.exit(0)` / SkipTest before the verdict   (Anthropic, METR)
 *   - `special-casing` correct only for the exact checked input      (ImpossibleBench)
 *   - `state-recording`memoize the grader's probes, garbage elsewhere(METR, monkey-patched grader)
 *
 * The four split into two families, each defended by a different real gate:
 *   - ORACLE-SIDE (`equals-true`, `exit-zero`): neuter the CHECK. Caught by MUTATION — a neutered
 *     oracle's kill ratio drops below 1, so the surviving mutant reds the gate.
 *   - IMPL-SIDE (`special-casing`, `state-recording`): special-case the PRODUCT to the check. Caught
 *     by a PROPERTY over FRESH inputs — the weak-oracle-surface investment (ADR-0033 correction #3):
 *     an example-only oracle greens the cheat, a property reds it.
 *
 * Each case carries BOTH halves of the falsification: `greensWeakCheck()` proves the cheat is real
 * theater (a weak check passes it — spike C1), `caughtByDefense()` proves the designated gate still
 * has teeth (it reds the cheat — spike C2). `scripts/prove-adversarial.ts` runs the battery.
 */

export type Impl = (upvotes: number, downvotes: number) => number
export type Oracle = (impl: Impl) => boolean
export type AttackFamily = 'oracle-side' | 'impl-side'
export type AttackId = 'equals-true' | 'exit-zero' | 'special-casing' | 'state-recording'

/** The fixed example pairs a special-casing agent overfits to (the "checked inputs"). */
const EXAMPLE_PAIRS: readonly (readonly [number, number])[] = [
  [3, 1],
  [0, 0],
  [2, 5],
  [1, 0],
]

/**
 * The faithful EXAMPLE oracle: asserts the impl matches `tally` on the fixed examples. Strong enough
 * to kill every oracle-NEUTERING attack (it reds a broken impl on these inputs), but too weak to catch
 * an IMPL-side cheat that special-cases exactly these inputs — which is the whole point.
 */
const exampleOracle: Oracle = (impl) => EXAMPLE_PAIRS.every(([u, d]) => impl(u, d) === tally(u, d))

/**
 * The PROPERTY oracle: asserts the impl matches `tally` over a deterministic sample of FRESH inputs
 * (fixed seed, no wall-clock randomness). This is the weak-oracle surface the impl-side cheats cannot
 * survive: they are correct only where they were probed, and fresh inputs leave the probe set.
 */
const PROPERTY_SEED = 0x9e1
const PROPERTY_RUNS = 200
const FRESH_PAIRS: readonly (readonly [number, number])[] = fc.sample(
  fc.tuple(fc.integer({ min: 0, max: 50 }), fc.integer({ min: 0, max: 50 })),
  { numRuns: PROPERTY_RUNS, seed: PROPERTY_SEED },
)
const propertyOracle: Oracle = (impl) => FRESH_PAIRS.every(([u, d]) => impl(u, d) === tally(u, d))

/** Mutation kill ratio of an arbitrary oracle over the shared MUTANTS (1 = every mutant killed). */
export function killRatioOf(oracle: Oracle): number {
  const killed = MUTANTS.filter((m) => !oracle(m.fn)).length
  return killed / MUTANTS.length
}

// ── ORACLE-SIDE cheats: the check is neutered. Both collapse to "always green", which is exactly why
// the mutation gate is the right defender — it measures P(red | behavior broken), so a neutered oracle
// scores 0 no matter HOW it was neutered. ──
const equalsTrueOracle: Oracle = () => true // the __eq__→True / assertion-less matcher
const exitZeroOracle: Oracle = () => true // bailed (sys.exit(0) / SkipTest) before the verdict

// A representative broken impl the neutered oracle waves through (any non-equivalent mutant works).
const BROKEN_IMPL: Impl = MUTANTS[0]?.fn ?? ((u, d) => u + d)

// ── IMPL-SIDE cheats: the product is special-cased to the check. ──
/** Correct only on the example inputs an agent overfits to; a wrong constant everywhere else. */
const specialCasedImpl: Impl = (u, d) =>
  EXAMPLE_PAIRS.some(([eu, ed]) => eu === u && ed === d) ? tally(u, d) : 0

/** Memoize the answer for inputs SEEN during probing (the grader monkey-patch), garbage for novel ones. */
function makeStateRecordingImpl(): Impl {
  const seen = new Map<string, number>()
  for (const [u, d] of EXAMPLE_PAIRS) seen.set(`${u},${d}`, tally(u, d))
  return (u, d) => seen.get(`${u},${d}`) ?? 0
}

export interface AttackCase {
  readonly id: AttackId
  readonly label: string
  readonly source: string
  readonly family: AttackFamily
  readonly defense: string
  /** A weak check passes the cheat — proof it is a real cheat, not a strawman (spike C1). */
  greensWeakCheck(): boolean
  /** The designated defense reds the cheat — proof the named gate has teeth (spike C2). */
  caughtByDefense(): boolean
}

export const ATTACK_TAXONOMY: readonly AttackCase[] = [
  {
    id: 'equals-true',
    label: '`__eq__`→True / assertion-less matcher',
    source: 'ImpossibleBench (GPT-5 cheated 76%)',
    family: 'oracle-side',
    defense: 'mutation kill ratio (a neutered oracle scores < 1)',
    greensWeakCheck: () => equalsTrueOracle(BROKEN_IMPL),
    caughtByDefense: () => killRatioOf(equalsTrueOracle) < 1,
  },
  {
    id: 'exit-zero',
    label: '`sys.exit(0)` / SkipTest before the verdict',
    source: 'Anthropic / METR',
    family: 'oracle-side',
    defense: 'mutation kill ratio (a bailed oracle scores < 1)',
    greensWeakCheck: () => exitZeroOracle(BROKEN_IMPL),
    caughtByDefense: () => killRatioOf(exitZeroOracle) < 1,
  },
  {
    id: 'special-casing',
    label: 'correct only for the exact checked input',
    source: 'ImpossibleBench',
    family: 'impl-side',
    defense: 'property over fresh inputs (an example-only oracle is blind)',
    greensWeakCheck: () => exampleOracle(specialCasedImpl),
    caughtByDefense: () => !propertyOracle(specialCasedImpl),
  },
  {
    id: 'state-recording',
    label: 'memoize the grader probes, garbage elsewhere',
    source: 'METR (monkey-patched grader)',
    family: 'impl-side',
    defense: 'property over fresh inputs (the probe set is left behind)',
    greensWeakCheck: () => exampleOracle(makeStateRecordingImpl()),
    caughtByDefense: () => !propertyOracle(makeStateRecordingImpl()),
  },
]

export interface AttackVerdict {
  readonly id: AttackId
  readonly family: AttackFamily
  readonly source: string
  readonly defense: string
  /** The cheat is real theater (a weak check greens it). */
  readonly greensWeakCheck: boolean
  /** The designated gate caught it (it reds the cheat). */
  readonly caught: boolean
}

/** Run the whole taxonomy and report, per named attack, whether it is real theater AND caught. */
export function runAdversarialTaxonomy(): readonly AttackVerdict[] {
  return ATTACK_TAXONOMY.map((a) => ({
    id: a.id,
    family: a.family,
    source: a.source,
    defense: a.defense,
    greensWeakCheck: a.greensWeakCheck(),
    caught: a.caughtByDefense(),
  }))
}

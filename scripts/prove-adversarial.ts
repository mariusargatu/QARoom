import { runAdversarialTaxonomy } from '@qaroom/testing-utils/agentic'

/**
 * `pnpm prove:adversarial`: the adversarial generalization of `pnpm prove <id> --break` (T23,
 * ADR-0033). An author-planted mutant is a SELECTION EFFECT — the gate is only ever proven against the
 * cheat the author imagined. This seeds the mutants from the NAMED attack taxonomy the empirical record
 * measured (ImpossibleBench / METR / Anthropic) and asserts, per attack, that it is BOTH real theater
 * (a weak check greens it) AND caught by its designated gate (the gate reds it). Exits non-zero if any
 * named attack slips a gate — a real finding to fix, never a paper-over.
 */

const useColor = !process.env.NO_COLOR && process.stdout.isTTY
const paint = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s)
const green = (s: string) => paint('32', s)
const red = (s: string) => paint('31;1', s)
const dim = (s: string) => paint('2', s)
const bold = (s: string) => paint('1', s)

function main(): void {
  const verdicts = runAdversarialTaxonomy()
  process.stdout.write(
    `\n${bold('QARoom: adversarial prove')} ${dim('— the named attack taxonomy vs. the gates')}\n\n`,
  )
  let holes = 0
  for (const v of verdicts) {
    const ok = v.greensWeakCheck && v.caught
    if (!ok) holes += 1
    process.stdout.write(
      `  ${ok ? green('✓') : red('✗')} ${v.id.padEnd(16)} ${dim(`[${v.family}]`)} ${dim(v.source)}\n`,
    )
    process.stdout.write(
      `      ${dim('theater:')} a weak check ${v.greensWeakCheck ? green('GREENS it') : red('does NOT green it (not a real cheat?)')}\n`,
    )
    process.stdout.write(
      `      ${dim('defense:')} ${v.defense} ${v.caught ? green('REDS it (caught)') : red('MISSED it')}\n`,
    )
  }
  if (holes > 0) {
    process.stderr.write(
      `\n${red(`prove:adversarial FAILED: ${holes} named attack(s) slipped a gate`)}\n`,
    )
    process.exit(1)
  }
  process.stdout.write(
    `\n${green('prove:adversarial ✓')}: every named attack is real theater AND caught by its designated gate\n`,
  )
}

main()

import { foldEvalRunner } from './lib/fold-eval-runner'

/** Fold a PyRIT nightly run into summary.json as the `pyrit` runner (ADR-0020):  pnpm pyrit:results */
foldEvalRunner('pyrit', { seedKey: 'pyrit_attack_seed' })

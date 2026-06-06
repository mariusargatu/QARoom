import { foldEvalRunner } from './lib/fold-eval-runner'

/** Fold a DeepEval run into summary.json as the `deepeval` runner (ADR-0020):  pnpm deepeval:results */
foldEvalRunner('deepeval', { seedKey: 'deepeval_seed' })

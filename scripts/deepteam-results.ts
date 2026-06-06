import { foldEvalRunner } from './lib/fold-eval-runner'

/** Fold a DeepTeam red-team run into summary.json as the `deepteam` runner (ADR-0020):  pnpm deepteam:results */
foldEvalRunner('deepteam', {
  seedKey: 'deepteam_attack_seed',
  extraOutput: (metrics) => ({ vulnerabilities: metrics?.vulnerabilities ?? [] }),
})

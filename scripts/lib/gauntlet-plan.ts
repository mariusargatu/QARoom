import type { GauntletStep } from './gauntlet-steps'

/**
 * The gauntlet plan as data: which step runs in which phase, under which failure class, with
 * which skip conditions. scripts/gauntlet.ts owns preflight + execution; this file owns WHAT
 * runs. Phases 1–2 are the no-cluster lanes (Session 1); phases 3–9 (cluster, fuzzing, chaos,
 * compositions, aftermath, report) land with the cluster wiring session.
 */
export interface PreflightCtx {
  hasDocker: boolean
  hasK3d: boolean
  hasTilt: boolean
  hasKubectl: boolean
  hasHelm: boolean
  hasJava: boolean
  hasTracetest: boolean
  hasUv: boolean
  hasOpenAIKey: boolean
}

export interface GauntletOpts {
  pyrit: boolean
  triangulate: boolean
  reuseCluster: boolean
}

export const PHASE_TITLES: Record<number, string> = {
  1: 'Fast lane (in-proc, serial)',
  2: 'Mutation ∥ LLM evals (concurrent lanes)',
}

const MOD = 'services/moderator-agent'

export function buildPlan(ctx: PreflightCtx, opts: GauntletOpts): GauntletStep[] {
  const phase1: GauntletStep[] = [
    // MUST run first: aggregate-test-results.ts rewrites the summary envelope from scratch,
    // dropping any previously folded runner. Every fold below depends on this ordering.
    step(1, 'aggregate-vitest', 'gate', 'pnpm', ['test-results:generate'], {
      timeoutMs: 25 * 60_000,
    }),
    step(1, 'fold-mbt-coverage', 'gate', 'pnpm', ['mbt:results']),
    step(1, 'verify-openapi', 'gate', 'pnpm', ['openapi:verify']),
    step(1, 'verify-asyncapi', 'gate', 'pnpm', ['asyncapi:verify']),
    step(1, 'verify-mcp-manifest', 'gate', 'pnpm', ['mcp:verify']),
    step(1, 'pact-providers', 'gate', 'pnpm', ['pact:results'], { timeoutMs: 20 * 60_000 }),
    step(1, 'moderator-pytest', 'gate', 'uv', ['run', 'pytest', '-q'], {
      cwd: MOD,
      skipReason: ctx.hasUv ? undefined : 'uv not installed',
    }),
    step(1, 'fold-moderator', 'gate', 'pnpm', ['moderator:results'], {
      skipReason: ctx.hasUv ? undefined : 'uv not installed',
    }),
    step(1, 'web-stories-coverage', 'gate', 'pnpm', [
      '--filter',
      '@qaroom/web',
      'run',
      'test:stories:coverage',
    ]),
    step(1, 'web-ct-coverage', 'gate', 'pnpm', ['--filter', '@qaroom/web', 'run', 'ct:coverage']),
    step(1, 'web-coverage-merge', 'gate', 'pnpm', [
      '--filter',
      '@qaroom/web',
      'run',
      'coverage:merge',
    ]),
    step(1, 'fold-web-ct', 'gate', 'pnpm', ['--filter', '@qaroom/web', 'run', 'ct:results']),
    step(1, 'fold-coverage', 'gate', 'pnpm', ['coverage:results']),
    step(1, 'verify-envelope', 'gate', 'pnpm', ['test-results:verify']),
  ]

  // Sanctioned concurrency: Stryker is CPU-bound mutation sandboxing, the LLM lane is
  // network-bound OpenAI round-trips — neither measures local wall-clock, so they share the slot.
  const noKey = ctx.hasOpenAIKey ? undefined : 'OPENAI_API_KEY not set'
  const noUv = ctx.hasUv ? undefined : 'uv not installed'
  const llmSkip = noKey ?? noUv
  const phase2: GauntletStep[] = [
    step(2, 'stryker-critical', 'gate', 'pnpm', ['stryker:critical'], {
      lane: 'mutation',
      timeoutMs: 60 * 60_000,
    }),
    step(2, 'fold-stryker', 'gate', 'pnpm', ['stryker:results'], { lane: 'mutation' }),
    step(
      2,
      'eval-cost-guard',
      'gate',
      'uv',
      ['run', 'python', '-m', 'moderator_agent.eval_cost_guard'],
      {
        lane: 'llm',
        cwd: MOD,
        skipReason: llmSkip,
      },
    ),
    step(2, 'evals-llm-golden-metamorphic', 'gate', 'uv', ['run', 'pytest', '-q', '-m', 'llm'], {
      lane: 'llm',
      cwd: MOD,
      skipReason: llmSkip,
    }),
    step(2, 'fold-golden', 'gate', 'pnpm', ['golden:results'], {
      lane: 'llm',
      skipReason: llmSkip,
    }),
    step(
      2,
      'evals-deepeval',
      'gate',
      'pnpm',
      ['--filter', '@qaroom/moderator-agent', 'run', 'eval:deepeval'],
      {
        lane: 'llm',
        skipReason: llmSkip,
      },
    ),
    step(2, 'fold-deepeval', 'gate', 'pnpm', ['deepeval:results'], {
      lane: 'llm',
      skipReason: llmSkip,
    }),
    step(
      2,
      'evals-deepteam',
      'gate',
      'pnpm',
      ['--filter', '@qaroom/moderator-agent', 'run', 'eval:deepteam'],
      {
        lane: 'llm',
        skipReason: llmSkip,
      },
    ),
    step(2, 'fold-deepteam', 'gate', 'pnpm', ['deepteam:results'], {
      lane: 'llm',
      skipReason: llmSkip,
    }),
    step(
      2,
      'evals-pyrit',
      'gate',
      'pnpm',
      ['--filter', '@qaroom/moderator-agent', 'run', 'eval:pyrit'],
      {
        lane: 'llm',
        timeoutMs: 60 * 60_000,
        skipReason:
          llmSkip ?? (opts.pyrit ? undefined : 'pyrit is opt-in (--pyrit) — longest, most spend'),
      },
    ),
    step(2, 'fold-pyrit', 'gate', 'pnpm', ['pyrit:results'], {
      lane: 'llm',
      skipReason: llmSkip ?? (opts.pyrit ? undefined : 'pyrit is opt-in (--pyrit)'),
    }),
  ]

  return [...phase1, ...phase2]
}

function step(
  phase: number,
  name: string,
  cls: GauntletStep['class'],
  cmd: string,
  args: string[],
  extra: Partial<GauntletStep> = {},
): GauntletStep {
  return {
    phase,
    phaseTitle: PHASE_TITLES[phase] ?? `Phase ${phase}`,
    name,
    class: cls,
    cmd,
    args,
    ...extra,
  }
}

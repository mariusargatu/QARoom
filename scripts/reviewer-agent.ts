/**
 * Reviewer agent (ADR-0026) — one LLM judge per touched boundary.
 *
 * Reads the boundary's own guardrail (its AGENTS.md) + the PR's diff for that boundary + VERIFIED
 * EVIDENCE (caller counts for removed symbols, unchanged drift-gated specs, manifest direction, and
 * this-commit gate results) that refutes false-impact findings, asks the model for guideline
 * violations, and BLOCKS Lane A on any P0–P2 finding. Cost is stamped per run
 * into test-results/reviewer-cost.json (OBSERVE-ONLY, no cap yet — ADR-0026 measure-first; the
 * ceiling is set from the measured p95 in Phase 2).
 *
 * The model call is the only impure part. Everything that decides — which guardrail, what blocks,
 * what a review costs, how to parse the model's JSON — is a pure exported function, unit-tested in
 * reviewer-agent.test.ts. No SDK dependency: a raw fetch to the OpenAI chat-completions API.
 *
 * Usage: `tsx scripts/reviewer-agent.ts <boundary> <baseSha> <headSha>`
 * Requires OPENAI_API_KEY. Exits non-zero if any P2+ finding remains (so Lane A is blocked).
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'

const ROOT = resolve(import.meta.dirname, '..')

// gpt-5-mini: higher recall than nano on subtle guideline violations (auth bypasses, hardcoded
// credentials) at a still-modest cost — the reviewer's job is to catch what lint can't. Prices are
// a PLACEHOLDER you own (gpt-5-mini has no vendored rate in cost-model.json yet; correct from the
// OpenAI pricing page). The cost stamp stays deterministic at rest, just approximate until then.
const MODEL = 'gpt-5-mini'
const PRICE = { inputPer1m: 0.25, outputPer1m: 2.0 }

// Structured Outputs: constrain the model to the exact finding shape so any model (mini included)
// can't drift the contract — severity stays in the P0–P3 enum, `line` is an integer or null. Without
// this, a model returns plausible-but-off-schema JSON and the strict parser (rightly) throws.
const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'reviewer_findings',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['findings'],
      properties: {
        findings: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['severity', 'file', 'line', 'rule', 'why'],
            properties: {
              severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
              file: { type: 'string' },
              line: { type: ['integer', 'null'] },
              rule: { type: 'string' },
              why: { type: 'string' },
            },
          },
        },
      },
    },
  },
} as const

const Severity = z.enum(['P0', 'P1', 'P2', 'P3'])

export const Finding = z.object({
  severity: Severity,
  file: z.string(),
  line: z.number().int().nullable().optional(),
  rule: z.string(),
  why: z.string(),
})
export type Finding = z.infer<typeof Finding>

const ModelResponse = z.object({ findings: z.array(Finding) })

/** Lane A is blocked by any P0–P2 finding. P3 is advisory (style), never blocks. (ADR-0026) */
export function blocks(findings: readonly Finding[]): boolean {
  return findings.some((f) => f.severity === 'P0' || f.severity === 'P1' || f.severity === 'P2')
}

/**
 * The guardrail a boundary is judged against: its own AGENTS.md if it has one, else the root
 * AGENTS.md (the repo-wide conventions). Returns a repo-relative path.
 */
export function guardrailPathFor(boundary: string): string {
  const own = `${boundary}/AGENTS.md`
  return existsSync(resolve(ROOT, own)) ? own : 'AGENTS.md'
}

/** USD for one review from the model's token usage and the vendored per-1M prices. */
export function costUsd(
  usage: { prompt_tokens: number; completion_tokens: number },
  price: { inputPer1m: number; outputPer1m: number } = PRICE,
): number {
  return (
    (usage.prompt_tokens / 1_000_000) * price.inputPer1m +
    (usage.completion_tokens / 1_000_000) * price.outputPer1m
  )
}

/** Parse + validate the model's JSON. Throws on anything that isn't the expected shape (no silent
 * pass: a judge whose output we can't trust must fail loudly, not approve by default). */
export function parseFindings(modelText: string): Finding[] {
  return ModelResponse.parse(JSON.parse(modelText)).findings
}

// ---- Verified evidence (ADR-0026 follow-up) -------------------------------------------------------
// The judge reasons from the guardrail + diff alone, so it speculates about IMPACT it cannot see —
// "removing X breaks consumers", "this drops the 400/429 response", "you changed the claims without
// the manifest". Every one of those is checkable from the repo, and when checked, refutes the
// finding. We compute the checks and hand them to the judge so it stops blocking on false positives.
// Same falsifiability discipline the repo applies to its claims, turned on the reviewer itself.

/** Single-source manifests every doc/DSL projection derives from (AGENTS.md / ADR-0024). */
const MANIFEST_PATHS = [
  'scripts/lib/manifests/claims.ts',
  'scripts/lib/manifests/detection-matrix.ts',
  'scripts/lib/manifests/boundary-registry.ts',
] as const

/** Generated, drift-gated artifacts whose stability proves a contract did/didn't move. */
function generatedArtifactsFor(boundary: string): string[] {
  return [
    `${boundary}/openapi.yaml`,
    `${boundary}/asyncapi.yaml`,
    'services/qaroom-mcp/mcp-manifest.json',
  ]
}

/** Identifiers removed or un-exported in the diff: removed `export <decl> Name` lines and removed
 * `export { … }` barrel members. A removal is only "breaking" if these still have callers elsewhere. */
export function removedSymbols(diff: string): string[] {
  const names = new Set<string>()
  for (const raw of diff.split('\n')) {
    if (!raw.startsWith('-') || raw.startsWith('---')) continue
    const line = raw.slice(1)
    const decl = line.match(
      /export\s+(?:abstract\s+)?(?:const|function|class|interface|type|enum)\s+(\w+)/,
    )
    if (decl) names.add(decl[1])
    const brace = line.match(/export\s+(?:type\s+)?\{([^}]+)\}/)
    if (brace)
      for (const part of brace[1].split(',')) {
        const m = part.trim().match(/^(?:type\s+)?(\w+)/)
        if (m) names.add(m[1])
      }
  }
  return [...names]
}

/** Generated specs under the boundary that EXIST but did NOT change in this PR (CI byte-gates them,
 * so unchanged ⇒ the public contract is provably stable). */
export function unchangedSpecsFor(boundary: string, changedFiles: readonly string[]): string[] {
  return generatedArtifactsFor(boundary).filter(
    (p) => existsSync(resolve(ROOT, p)) && !changedFiles.includes(p),
  )
}

/** Which single-source manifests changed in this PR (none ⇒ projections are being synced TO them). */
export function changedManifests(changedFiles: readonly string[]): string[] {
  return MANIFEST_PATHS.filter((p) => changedFiles.includes(p))
}

export interface GateLine {
  name: string
  passed: boolean
}

/** Per-runner pass/fail from a test-results/summary.json envelope (best-effort: [] if unreadable). */
export function summariseGates(summaryJson: string): GateLine[] {
  try {
    const s = JSON.parse(summaryJson) as { runners?: { name: string; failed?: number }[] }
    return (s.runners ?? []).map((r) => ({ name: r.name, passed: (r.failed ?? 0) === 0 }))
  } catch {
    return []
  }
}

export interface ReviewEvidence {
  callers: { symbol: string; callers: number }[]
  unchangedSpecs: string[]
  manifestsChanged: string[]
  gates: GateLine[]
}

/** The evidence block + the refutation rules the judge must apply before blocking. */
export function renderEvidence(e: ReviewEvidence): string {
  const out = ['=== VERIFIED EVIDENCE (trust this over your own guesses about impact) ===']
  if (e.callers.length) {
    out.push(
      'Symbols removed/un-exported here, with repo-wide caller count (references OUTSIDE the changed files):',
    )
    for (const c of e.callers) out.push(`  - ${c.symbol}: ${c.callers} caller(s)`)
    out.push(
      'RULE: a finding that a removal/rename "breaks consumers" / "is a breaking API change" / "tests fail to compile" is FALSE when callers = 0. Drop it (P3 at most).',
    )
  }
  if (e.unchangedSpecs.length) {
    out.push(`Generated, drift-gated specs UNCHANGED in this PR: ${e.unchangedSpecs.join(', ')}.`)
    out.push(
      'RULE: these are generated from the Zod source and byte-gated in CI. UNCHANGED ⇒ the public contract did not move — a finding claiming "contract drift" / "dropped response (e.g. 400/429)" / "lost an OpenAPI response" is FALSE. Drop it.',
    )
  }
  if (e.manifestsChanged.length === 0) {
    out.push(
      'Single-source manifests (claims / detection-matrix / boundary-registry): UNCHANGED in this PR.',
    )
    out.push(
      'RULE: docs and *.dsl are PROJECTIONS of those manifests. A projection that changed while the manifest did not is being SYNCED to the manifest — that is correct, not drift. Do not flag "changed the claims/views without updating the manifest".',
    )
  }
  if (e.gates.length) {
    const failing = e.gates.filter((g) => !g.passed).map((g) => g.name)
    out.push(
      `Gate results on THIS commit (test-results/summary.json): ${e.gates.length} runner(s), ${failing.length} failing${failing.length ? ` (${failing.join(', ')})` : ''}.`,
    )
    out.push(
      'RULE: before any P0–P2 finding, name the runner/gate it predicts would turn RED. If that runner is GREEN here, the impact claim is refuted — downgrade to P3 or drop. Green tests refute "this breaks X".',
    )
  }
  return out.join('\n')
}

export function buildPrompt(
  guardrail: string,
  diff: string,
  boundary: string,
  evidence = '',
): string {
  return [
    `You are the reviewer for the "${boundary}" boundary of the QARoom codebase.`,
    'Judge the diff ONLY against the guardrail below. Do not invent rules.',
    'Severity: P0 data loss/security, P1 correctness, P2 missing idempotency/timeout/contract drift,',
    'P3 style (never blocks). `severity` MUST be exactly one of P0,P1,P2,P3. `line` is an integer',
    'or null. Cite file and line. If clean, return an empty findings array.',
    'A finding that contradicts the VERIFIED EVIDENCE below is WRONG — the evidence is checked against',
    'the real repo and overrides your speculation about impact. Apply its rules before you emit.',
    ...(evidence ? ['', evidence] : []),
    '',
    '=== GUARDRAIL ===',
    guardrail,
    '',
    '=== DIFF ===',
    diff,
  ].join('\n')
}

function git(args: readonly string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
}

/** Repo-wide references to `symbol` in TS/TSX EXCLUDING the files changed in this PR. 0 ⇒ removing or
 * un-exporting it breaks no consumer. Word-matched + fixed-string; approximate evidence by design. */
function countCallers(symbol: string, changedFiles: ReadonlySet<string>): number {
  let out = ''
  try {
    out = git(['grep', '-I', '-l', '-w', '--fixed-strings', symbol, '--', '*.ts', '*.tsx'])
  } catch {
    return 0 // git grep exits non-zero when there are no matches
  }
  return out.split('\n').filter((f) => f.length > 0 && !changedFiles.has(f)).length
}

/** Gather the verified evidence (caller counts / unchanged specs / manifest direction / gate results)
 * the judge must reconcile against before blocking. All cheap + local; gates are best-effort. */
function gatherEvidence(
  boundary: string,
  base: string,
  head: string,
  diff: string,
): ReviewEvidence {
  const changedFiles = git(['diff', '--name-only', `${base}...${head}`])
    .split('\n')
    .filter((f) => f.length > 0)
  const changedSet = new Set(changedFiles)
  // Cap to keep the prompt bounded on a large refactor; the long tail is rarely the contested finding.
  const symbols = removedSymbols(diff).slice(0, 25)
  const callers = symbols.map((symbol) => ({ symbol, callers: countCallers(symbol, changedSet) }))
  const summaryPath = resolve(ROOT, 'test-results/summary.json')
  const gates = existsSync(summaryPath) ? summariseGates(readFileSync(summaryPath, 'utf8')) : []
  return {
    callers,
    unchangedSpecs: unchangedSpecsFor(boundary, changedFiles),
    manifestsChanged: changedManifests(changedFiles),
    gates,
  }
}

async function callModel(
  prompt: string,
): Promise<{ text: string; usage: { prompt_tokens: number; completion_tokens: number } }> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not set — reviewer-agent cannot judge')
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: RESPONSE_FORMAT,
    }),
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as {
    choices: { message: { content: string } }[]
    usage: { prompt_tokens: number; completion_tokens: number }
  }
  return { text: json.choices[0].message.content, usage: json.usage }
}

function stampCost(entry: Record<string, unknown>): void {
  const dir = resolve(ROOT, 'test-results')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const path = resolve(dir, 'reviewer-cost.json')
  const prior = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as unknown[]) : []
  writeFileSync(path, `${JSON.stringify([...prior, entry], null, 2)}\n`)
}

async function main(): Promise<void> {
  const boundary = process.argv[2]
  const base = process.argv[3] ?? 'origin/main'
  const head = process.argv[4] ?? 'HEAD'
  if (!boundary) throw new Error('usage: reviewer-agent.ts <boundary> <baseSha> <headSha>')

  // repo-root bundles unrelated top-level files; no single guardrail fits, so skip (route by lane).
  if (boundary === 'repo-root') {
    process.stdout.write('repo-root boundary skipped (no single guardrail)\n')
    return
  }

  const diff = git(['diff', `${base}...${head}`, '--', boundary])
  if (diff.trim().length === 0) {
    process.stdout.write(`no diff under ${boundary}\n`)
    return
  }

  const guardrail = readFileSync(resolve(ROOT, guardrailPathFor(boundary)), 'utf8')
  const evidence = renderEvidence(gatherEvidence(boundary, base, head, diff))
  const { text, usage } = await callModel(buildPrompt(guardrail, diff, boundary, evidence))
  const findings = parseFindings(text)
  const blocked = blocks(findings)
  const usd = costUsd(usage)

  stampCost({
    boundary,
    model: MODEL,
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    usd: Number(usd.toFixed(6)),
    findings: findings.length,
    blocked,
  })

  const summary = process.env.GITHUB_STEP_SUMMARY
  const lines = [
    `### Reviewer · ${boundary} · $${usd.toFixed(4)} · ${findings.length} finding(s)`,
    ...findings.map(
      (f) => `- **${f.severity}** \`${f.file}${f.line ? `:${f.line}` : ''}\` ${f.rule} — ${f.why}`,
    ),
    findings.length === 0 ? '- clean' : '',
  ].filter(Boolean)
  if (summary) appendFileSync(summary, `${lines.join('\n')}\n`)
  process.stdout.write(`${JSON.stringify({ boundary, blocked, findings, usd })}\n`)

  if (blocked) process.exit(1)
}

// Only run when invoked directly (tsx scripts/reviewer-agent.ts ...), not when imported by the test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(2)
  })
}

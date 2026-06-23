/**
 * Reviewer agent (ADR-0026) — one LLM judge per touched boundary.
 *
 * Reads the boundary's own guardrail (its AGENTS.md) + the PR's diff for that boundary, asks the
 * model for guideline violations, and BLOCKS Lane A on any P0–P2 finding. Cost is stamped per run
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

const Severity = z.enum(['P0', 'P1', 'P2', 'P3'])

export const Finding = z.object({
  severity: Severity,
  file: z.string(),
  line: z.number().int().optional(),
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

export function buildPrompt(guardrail: string, diff: string, boundary: string): string {
  return [
    `You are the reviewer for the "${boundary}" boundary of the QARoom codebase.`,
    'Judge the diff ONLY against the guardrail below. Do not invent rules.',
    'Severity: P0 data loss/security, P1 correctness, P2 missing idempotency/timeout/contract drift,',
    'P3 style (never blocks). Cite file and line. If clean, return an empty findings array.',
    'Respond as JSON: {"findings":[{"severity","file","line","rule","why"}]}.',
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
      response_format: { type: 'json_object' },
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
  const { text, usage } = await callModel(buildPrompt(guardrail, diff, boundary))
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

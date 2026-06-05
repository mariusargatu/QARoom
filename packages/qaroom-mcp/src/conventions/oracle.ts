import parser from '@typescript-eslint/parser'
import { type ESLint, Linter } from 'eslint'
import qaroom from 'eslint-plugin-qaroom'
import type { ConventionsVerdict, ConventionViolation } from '../schema/mcp'

/**
 * The conventions oracle wraps eslint-plugin-qaroom (ADR-0006). It runs the SAME rules
 * CI enforces over a snippet and returns a typed verdict — so an agent can self-check
 * determinism / test-shape conventions before it writes code, not after CI rejects it.
 */
export interface ConventionsInput {
  code: string
  filename?: string
  rules?: string[]
}

export interface ConventionsOracle {
  check(input: ConventionsInput): ConventionsVerdict
}

// A curated, snippet-checkable subset of eslint.config.js (the .tsx-only and filename-context
// rules are intentionally excluded). The guard below fails loudly if one of these ids is renamed
// or removed in eslint-plugin-qaroom, so the oracle can't silently pass a snippet CI would reject.
const PRODUCTION_RULES = [
  'no-new-date',
  'no-unseeded-random',
  'no-public-barrel',
  'no-raw-nats-subject',
]
const TEST_RULES = ['test-name-shape', 'no-conditional-in-test', 'no-snapshot']
const ALL_RULES = new Set([...PRODUCTION_RULES, ...TEST_RULES])

const pluginRules = qaroom.rules ?? {}
for (const rule of ALL_RULES) {
  if (!(rule in pluginRules)) {
    throw new Error(`conventions oracle names a rule absent from eslint-plugin-qaroom: ${rule}`)
  }
}

// A snippet whose filename ends in these is checked with the test rule-set (mirrors eslint.config.js).
const TEST_FILE = /\.(test|spec)\.ts$/

// Bound the parser's work. The MCP tool schema also caps `code` (AJV rejects oversize at callTool);
// this is the defence for direct callers of the oracle.
const MAX_SNIPPET_CHARS = 100_000

function defaultRuleSet(filename: string): string[] {
  return TEST_FILE.test(filename) ? TEST_RULES : PRODUCTION_RULES
}

function selectRules(filename: string, requested?: string[]): string[] {
  if (!requested || requested.length === 0) return defaultRuleSet(filename)
  const normalized = requested.map((rule) => rule.replace(/^qaroom\//, ''))
  return normalized.filter((rule) => ALL_RULES.has(rule))
}

function ruleConfig(ruleIds: string[]): Linter.RulesRecord {
  const rules: Linter.RulesRecord = {}
  for (const id of ruleIds) rules[`qaroom/${id}`] = 'error'
  return rules
}

export function createConventionsOracle(): ConventionsOracle {
  const linter = new Linter({ configType: 'flat' })
  const plugin: ESLint.Plugin = qaroom
  const tsParser = parser as unknown as Linter.Parser

  return {
    check({ code, filename, rules }) {
      if (code.length > MAX_SNIPPET_CHARS) {
        return {
          ok: false,
          checked_rules: [],
          violations: [
            {
              rule: 'snippet-too-large',
              message: `Snippet exceeds ${MAX_SNIPPET_CHARS} characters; refusing to lint.`,
              line: 0,
              column: 0,
            },
          ],
        }
      }
      const fname = filename ?? 'snippet.ts'
      const ruleIds = selectRules(fname, rules)
      const config: Linter.Config = {
        // A flat config needs a `files` match or ESLint reports "no matching configuration".
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: {
          parser: tsParser,
          parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
        },
        plugins: { qaroom: plugin },
        rules: ruleConfig(ruleIds),
      }
      const messages = linter.verify(code, [config], fname)
      const violations: ConventionViolation[] = messages
        .filter((message) => message.ruleId !== null && message.ruleId !== undefined)
        .map((message) => ({
          rule: (message.ruleId ?? '').replace(/^qaroom\//, ''),
          message: message.message,
          line: message.line,
          column: message.column,
        }))
      return { ok: violations.length === 0, checked_rules: ruleIds, violations }
    },
  }
}

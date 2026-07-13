/**
 * eslint-plugin-qaroom — QARoom's enforced conventions that need AST awareness.
 *
 * Biome owns formatting + `noExplicitAny`. This plugin owns the rules that are
 * either AST-heavy or QARoom-specific:
 *   - no-new-date            (Commitment 6)
 *   - no-unseeded-random     (Commitment 6)
 *   - test-name-shape        (Milestone 0 spike 6)
 *   - no-conditional-in-test (AGENTS.md "Conventions — the gate is the spec")
 *   - no-snapshot            (Commitment 3 — snapshots make drift invisible)
 *   - no-public-barrel       (AGENTS.md "Conventions — the gate is the spec")
 *   - no-raw-nats-subject    (Commitment 17 / Milestone 4)
 *
 * Citations are stable anchors (Commitment ids, spikes, the AGENTS.md conventions
 * section), never doc line numbers: a folded doc moves lines and strands the reader.
 *
 * Rules are plain JS so they need no build step.
 */

/** @type {import('eslint').Rule.RuleModule} */
const noNewDate = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow `new Date()` outside the determinism layer; use the injected Clock.',
    },
    // `allowArgs`: in test files a fixed-arg `new Date('2026-01-01')` is a deterministic literal and is
    // fine; only the wall-clock zero-arg `new Date()` (and `Date.now()`) is the flake source. Production
    // code passes no option, so every form is still banned there.
    schema: [
      {
        type: 'object',
        properties: { allowArgs: { type: 'boolean' } },
        additionalProperties: false,
      },
    ],
    messages: {
      banned:
        'Direct `new Date()` is a P0 determinism leak (Commitment 6). Read `clock.now()` from the injected Clock instead.',
    },
  },
  create(context) {
    const allowArgs = context.options[0]?.allowArgs === true
    return {
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'Date') {
          // Relaxed test mode keeps the deterministic fixed-arg literal, bans only the wall-clock form.
          if (allowArgs && node.arguments.length > 0) return
          context.report({ node, messageId: 'banned' })
        }
      },
      // also catch Date.now()
      'CallExpression > MemberExpression'(node) {
        if (
          node.object.type === 'Identifier' &&
          node.object.name === 'Date' &&
          node.property.type === 'Identifier' &&
          node.property.name === 'now'
        ) {
          context.report({ node: node.parent, messageId: 'banned' })
        }
      },
    }
  },
}

/** @type {import('eslint').Rule.RuleModule} */
const noUnseededRandom = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow Math.random / crypto.randomUUID; use the injected Randomness or IdGenerator.',
    },
    schema: [],
    messages: {
      math: 'Direct `Math.random()` is a determinism leak (Commitment 6). Use the injected `Randomness`.',
      uuid: 'Direct UUID generation is a determinism leak (Commitment 6). Use the injected `IdGenerator`.',
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (
          node.object.type === 'Identifier' &&
          node.object.name === 'Math' &&
          node.property.type === 'Identifier' &&
          node.property.name === 'random'
        ) {
          context.report({ node, messageId: 'math' })
        }
        if (node.property.type === 'Identifier' && node.property.name === 'randomUUID') {
          context.report({ node, messageId: 'uuid' })
        }
      },
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'randomUUID') {
          context.report({ node, messageId: 'uuid' })
        }
      },
    }
  },
}

const TEST_CALLEES = new Set(['it', 'test', 'describe', 'bench'])
const LOW_SIGNAL = [
  /^(it )?works\b/i,
  /happy path/i,
  /^basic test$/i,
  /^returns? correctly$/i,
  /^should work$/i,
  /^test\b/i,
  /^smoke$/i,
]

function testCalleeName(callee) {
  if (callee.type === 'Identifier') return callee.name
  if (callee.type === 'MemberExpression' && callee.object.type === 'Identifier')
    return callee.object.name
  return undefined
}

/** @type {import('eslint').Rule.RuleModule} */
const testNameShape = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Test titles must describe the property/invariant, not the function or "works".',
    },
    schema: [],
    messages: {
      shape:
        'Test title "{{title}}" does not describe an invariant. Describe the behaviour/property, e.g. "voting on a deleted post returns 410 with the deletion problem-details".',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const name = testCalleeName(node.callee)
        if (!name || !TEST_CALLEES.has(name)) return
        const first = node.arguments[0]
        if (first?.type !== 'Literal' || typeof first.value !== 'string') return
        const title = first.value
        const isDescribe = name === 'describe'

        const callStyle = /\w+\(\)/.test(title)
        const lowSignal = LOW_SIGNAL.some((re) => re.test(title))
        // `it`/`test` titles must be multi-word invariant descriptions; `describe` may be a noun label.
        const tooTerse = !isDescribe && title.trim().split(/\s+/).length < 2

        if (callStyle || lowSignal || tooTerse) {
          context.report({ node: first, messageId: 'shape', data: { title } })
        }
      },
    }
  },
}

/** @type {import('eslint').Rule.RuleModule} */
const noConditionalInTest = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'No conditional logic in tests; write two tests instead (AGENTS.md "Conventions — the gate is the spec").',
    },
    schema: [],
    messages: {
      cond: 'Conditional logic in tests is forbidden — split into two tests, each asserting one branch (AGENTS.md "Conventions — the gate is the spec").',
    },
  },
  create(context) {
    return {
      IfStatement(node) {
        context.report({ node, messageId: 'cond' })
      },
      TryStatement(node) {
        context.report({ node, messageId: 'cond' })
      },
    }
  },
}

const SNAPSHOT_MATCHERS = new Set([
  'toMatchSnapshot',
  'toMatchInlineSnapshot',
  'toMatchFileSnapshot',
  'toThrowErrorMatchingSnapshot',
  'toThrowErrorMatchingInlineSnapshot',
])

/** @type {import('eslint').Rule.RuleModule} */
const noSnapshot = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Snapshot testing is forbidden anywhere (Commitment 3 — it makes drift invisible).',
    },
    schema: [],
    messages: {
      snapshot:
        'Snapshot matcher `{{name}}` is forbidden — it makes drift invisible (Commitment 3). Assert explicit, hand-authored expectations.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee
        if (
          callee.type === 'MemberExpression' &&
          callee.property.type === 'Identifier' &&
          SNAPSHOT_MATCHERS.has(callee.property.name)
        ) {
          context.report({ node, messageId: 'snapshot', data: { name: callee.property.name } })
        }
      },
    }
  },
}

/** @type {import('eslint').Rule.RuleModule} */
const noPublicBarrel = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'No `export *` barrels; re-export named symbols explicitly (AGENTS.md "Conventions — the gate is the spec").',
    },
    schema: [],
    messages: {
      barrel:
        'Barrel `export *` is forbidden (AGENTS.md "Conventions — the gate is the spec"). Re-export the specific named symbols you mean to expose.',
    },
  },
  create(context) {
    return {
      ExportAllDeclaration(node) {
        context.report({ node, messageId: 'barrel' })
      },
    }
  },
}

// A raw NATS subject literal matches the subject grammar at the START of the string:
// `qaroom.<service>.<entity>…` (docs/05 §3). Anchoring + requiring two dotted segments
// excludes false positives like the `https://qaroom.dev/...` error/issuer URIs and the
// `qaroom.lamport` span-attribute key, which are not subjects. Subject construction is
// centralised in `packages/contracts/src/subjects.ts`, the single sanctioned home for
// these literals; everything else must call its builders.
const RAW_SUBJECT_PATTERN = /^qaroom\.[a-z_]+\.[a-z_]+/

/**
 * Is `filename` the one module allowed to author raw `qaroom.*` subject literals?
 * Matched on a normalised, OS-agnostic suffix so it holds for both the absolute paths
 * ESLint supplies at runtime and the `<input>` placeholder RuleTester uses.
 *
 * @param {string} filename - The file being linted (`context.filename`).
 * @returns {boolean} True for `packages/contracts/src/subjects.ts`.
 */
function isSubjectsModule(filename) {
  return filename.replace(/\\/g, '/').endsWith('packages/contracts/src/subjects.ts')
}

/**
 * Is `filename` a test file? Mirrors the `*.test.ts` / `*.spec.ts` exemption the
 * determinism rules get via the ESLint config's `files`/`ignores` globs, applied here
 * in-rule so the exemption also holds under RuleTester (which bypasses that config).
 *
 * @param {string} filename - The file being linted (`context.filename`).
 * @returns {boolean} True for `*.test.ts` / `*.spec.ts` (incl. `*.property.test.ts`).
 */
function isTestFile(filename) {
  const normalised = filename.replace(/\\/g, '/')
  return /\.(test|spec)\.ts$/.test(normalised)
}

/** @type {import('eslint').Rule.RuleModule} */
const noRawNatsSubject = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow raw `qaroom.*` NATS subject literals outside subjects.ts; use the subject builders (Commitment 17).',
    },
    schema: [],
    messages: {
      raw: 'Raw NATS subject literal — use the subject builders in @qaroom/contracts (subjects.ts), enforced for tenant-safety (Commitment 17).',
    },
  },
  create(context) {
    // `context.filename` is ESLint 9's accessor; fall back for older runtimes/test harnesses.
    const filename =
      context.filename ?? (typeof context.getFilename === 'function' ? context.getFilename() : '')
    if (isSubjectsModule(filename) || isTestFile(filename)) {
      return {}
    }
    return {
      Literal(node) {
        if (typeof node.value === 'string' && RAW_SUBJECT_PATTERN.test(node.value)) {
          context.report({ node, messageId: 'raw' })
        }
      },
      TemplateLiteral(node) {
        const hasRawSubject = node.quasis.some((quasi) => RAW_SUBJECT_PATTERN.test(quasi.value.raw))
        if (hasRawSubject) {
          context.report({ node, messageId: 'raw' })
        }
      },
    }
  },
}

/**
 * Milestone 5 / ADR-0005 frontend-testing discipline. These run on `.tsx` (the determinism
 * rules deliberately do not — see eslint.config.js), so they carry no overlap.
 */

const ATOMIC_TIERS = ['atoms', 'molecules', 'organisms', 'templates', 'pages']

/** The atomic tier a path belongs to (its index in ATOMIC_TIERS), or -1 if none. */
function tierIndexOf(pathLike) {
  const normalised = pathLike.replace(/\\/g, '/')
  for (let i = 0; i < ATOMIC_TIERS.length; i++) {
    if (normalised.includes(`/${ATOMIC_TIERS[i]}/`) || normalised.includes(`${ATOMIC_TIERS[i]}/`)) {
      return i
    }
  }
  return -1
}

/**
 * Atomic-design dependency direction (ADR-0005): a component in tier T may import only from
 * tiers below it. Flags an import whose source path names a higher tier than the file's tier.
 * Files outside the tiers (hooks, pages-less utilities) are skipped.
 * @type {import('eslint').Rule.RuleModule}
 */
const atomicImportDirection = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Atomic-design tiers flow downward only: atoms ← molecules ← organisms ← templates ← pages (ADR-0005).',
    },
    schema: [],
    messages: {
      direction:
        'Atomic-design violation: a {{from}} component must not import from the higher tier {{to}} (`{{source}}`). Tiers flow downward only (ADR-0005).',
    },
  },
  create(context) {
    const filename =
      context.filename ?? (typeof context.getFilename === 'function' ? context.getFilename() : '')
    const fileTier = tierIndexOf(filename)
    if (fileTier < 0) return {}
    return {
      ImportDeclaration(node) {
        const source = node.source.value
        if (typeof source !== 'string') return
        const importTier = tierIndexOf(source)
        if (importTier > fileTier) {
          context.report({
            node,
            messageId: 'direction',
            data: { from: ATOMIC_TIERS[fileTier], to: ATOMIC_TIERS[importTier], source },
          })
        }
      },
    }
  },
}

/**
 * Genuinely weak matchers: they pass for a whole CLASS of values, so they can't fail on a wrong one.
 * `toBeDefined` (any non-undefined), `toBeTruthy` / `toBeFalsy` (any truthy/falsy) are the classic weak
 * oracle. Deliberately EXCLUDED because they pin an EXACT expected value: `toBeNull` / `toBeUndefined` /
 * `toBeNaN` (the rejection path returning anything else — e.g. a forged object instead of null — is the
 * bug they catch), and `toContain` / `toMatch` / `toHaveLength` (a specific element/shape/length).
 */
const WEAK_MATCHERS = new Set(['toBeDefined', 'toBeTruthy', 'toBeFalsy'])
// Only plain `it(...)` / `test(...)` blocks are judged. `test.prop(...)`, `it.each(...)`, `describe`, and
// helpers have non-Identifier callees and are skipped — property/parametrised tests carry their own oracle.
const ASSERTED_BLOCK_CALLEES = new Set(['it', 'test'])

/** The terminal matcher name of an `expect(...)….matcher()` chain, or undefined if the call isn't one. */
function expectMatcherName(callNode) {
  const callee = callNode.callee
  if (!callee || callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier') return
  const name = callee.property.name
  // Walk the object chain (`.not`, `.resolves`, `.rejects`, …) down to the root; it must be `expect(...)`.
  let cur = callee.object
  while (cur) {
    if (cur.type === 'CallExpression') {
      if (cur.callee.type === 'Identifier' && cur.callee.name === 'expect') return name
      cur = cur.callee
    } else if (cur.type === 'MemberExpression') {
      cur = cur.object
    } else {
      return
    }
  }
  return
}

/** Depth-first walk of a node subtree (skips `parent` back-edges). */
function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return
  visit(node)
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue
    const val = node[key]
    if (Array.isArray(val)) {
      for (const child of val) walk(child, visit)
    } else if (val && typeof val.type === 'string') {
      walk(val, visit)
    }
  }
}

/**
 * A test whose ONLY assertions are existence/truthiness checks is a weak oracle: it passes as long as the
 * value exists, never mind whether it's the *right* value. This is the body-level complement to
 * `test-name-shape` (which can only see the title). Flags an `it`/`test` block that has ≥1 `expect` matcher
 * and every one of them is weak. A single `toBe`/`toEqual`/`toContain`/etc. clears it.
 * @type {import('eslint').Rule.RuleModule}
 */
const noWeakOnlyAssertion = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'A test may not assert with existence/truthiness matchers alone; pin an expected value so it can fail on a wrong one.',
    },
    schema: [],
    messages: {
      weak: "This test's only assertions are existence/truthiness checks — it passes for any present value. Assert an explicit expected value (`toBe`/`toEqual`/`toContain`) so it fails on a wrong one.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee
        if (callee.type !== 'Identifier' || !ASSERTED_BLOCK_CALLEES.has(callee.name)) return
        const fn = node.arguments.find(
          (a) => a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression',
        )
        if (!fn?.body) return
        const matchers = []
        walk(fn.body, (n) => {
          if (n.type === 'CallExpression') {
            const name = expectMatcherName(n)
            if (name) matchers.push(name)
          }
        })
        if (matchers.length === 0) return
        if (matchers.every((m) => WEAK_MATCHERS.has(m))) {
          context.report({ node: node.arguments[0] ?? node, messageId: 'weak' })
        }
      },
    }
  },
}

export default {
  meta: { name: 'eslint-plugin-qaroom', version: '0.0.0' },
  rules: {
    'no-new-date': noNewDate,
    'no-unseeded-random': noUnseededRandom,
    'test-name-shape': testNameShape,
    'no-conditional-in-test': noConditionalInTest,
    'no-snapshot': noSnapshot,
    'no-public-barrel': noPublicBarrel,
    'no-raw-nats-subject': noRawNatsSubject,
    'atomic-import-direction': atomicImportDirection,
    'no-weak-only-assertion': noWeakOnlyAssertion,
  },
}

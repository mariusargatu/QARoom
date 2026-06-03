/**
 * eslint-plugin-qaroom — QARoom's enforced conventions that need AST awareness.
 *
 * Biome owns formatting + `noExplicitAny`. This plugin owns the rules that are
 * either AST-heavy or QARoom-specific:
 *   - no-new-date            (Commitment 6 / docs/05 L228)
 *   - no-unseeded-random     (Commitment 6 / docs/05 L229)
 *   - test-name-shape        (docs/05 L232, Milestone 0 spike 6)
 *   - no-conditional-in-test (docs/05 L230)
 *   - no-snapshot            (docs/05 L227)
 *   - no-public-barrel       (docs/05 L319)
 *   - no-raw-nats-subject    (Commitment 17 / Milestone 4)
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
    schema: [],
    messages: {
      banned:
        'Direct `new Date()` is a P0 determinism leak (Commitment 6). Read `clock.now()` from the injected Clock instead.',
    },
  },
  create(context) {
    return {
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'Date') {
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
    docs: { description: 'No conditional logic in tests; write two tests instead (docs/05 L230).' },
    schema: [],
    messages: {
      cond: 'Conditional logic in tests is forbidden (docs/05 L230). Split into two tests, each asserting one branch.',
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
    docs: { description: 'Snapshot testing is forbidden anywhere (docs/05 L227).' },
    schema: [],
    messages: {
      snapshot:
        'Snapshot matcher `{{name}}` is forbidden (docs/05 L227). Assert explicit, hand-authored expectations.',
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
      description: 'No `export *` barrels; re-export named symbols explicitly (docs/05 L319).',
    },
    schema: [],
    messages: {
      barrel:
        'Barrel `export *` is forbidden (docs/05 L319). Re-export the specific named symbols you mean to expose.',
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
  },
}

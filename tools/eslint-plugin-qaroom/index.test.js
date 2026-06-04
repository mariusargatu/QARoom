import { RuleTester } from 'eslint'
import { afterAll, describe, it } from 'vitest'
import plugin from './index.js'

RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
})

tester.run('no-new-date', plugin.rules['no-new-date'], {
  valid: ['const t = clock.now()'],
  invalid: [
    { code: 'const d = new Date()', errors: [{ messageId: 'banned' }] },
    { code: 'const d = new Date(0)', errors: [{ messageId: 'banned' }] },
    { code: 'const n = Date.now()', errors: [{ messageId: 'banned' }] },
  ],
})

tester.run('no-unseeded-random', plugin.rules['no-unseeded-random'], {
  valid: ['const r = randomness.next()', 'const id = ids.next("post")'],
  invalid: [
    { code: 'const r = Math.random()', errors: [{ messageId: 'math' }] },
    { code: 'const id = crypto.randomUUID()', errors: [{ messageId: 'uuid' }] },
    { code: 'const id = randomUUID()', errors: [{ messageId: 'uuid' }] },
  ],
})

tester.run('test-name-shape', plugin.rules['test-name-shape'], {
  valid: [
    'it("voting on a deleted post returns 410 with the deletion problem-details", () => {})',
    'describe("LamportGate", () => {})',
  ],
  invalid: [
    { code: 'it("works", () => {})', errors: [{ messageId: 'shape' }] },
    { code: 'it("vote() works", () => {})', errors: [{ messageId: 'shape' }] },
    { code: 'it("happy path", () => {})', errors: [{ messageId: 'shape' }] },
    { code: 'it("returns", () => {})', errors: [{ messageId: 'shape' }] },
  ],
})

tester.run('no-conditional-in-test', plugin.rules['no-conditional-in-test'], {
  valid: ['expect(value).toBe(1)'],
  invalid: [
    { code: 'if (cond) { run() }', errors: [{ messageId: 'cond' }] },
    { code: 'try { run() } catch (e) { handle(e) }', errors: [{ messageId: 'cond' }] },
  ],
})

tester.run('no-snapshot', plugin.rules['no-snapshot'], {
  valid: ['expect(value).toEqual({ a: 1 })'],
  invalid: [
    { code: 'expect(value).toMatchSnapshot()', errors: [{ messageId: 'snapshot' }] },
    { code: 'expect(value).toMatchInlineSnapshot()', errors: [{ messageId: 'snapshot' }] },
  ],
})

tester.run('no-public-barrel', plugin.rules['no-public-barrel'], {
  valid: ['export { a } from "./a"'],
  invalid: [{ code: 'export * from "./a"', errors: [{ messageId: 'barrel' }] }],
})

tester.run('no-raw-nats-subject', plugin.rules['no-raw-nats-subject'], {
  valid: [
    // A call site that goes through the builders carries no raw subject literal.
    { code: 'const subject = postCreated(communityId)', filename: 'services/content/src/emit.ts' },
    // The sanctioned home for raw subject literals is exempt.
    {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: RuleTester fixture — this string IS template-literal source under test.
      code: 'const subject = `${ROOT}.content.posts.${communityId}.created`',
      filename: 'packages/contracts/src/subjects.ts',
    },
    // Tests legitimately assert on concrete subject strings; *.test.ts is exempt.
    {
      code: "expect(subject).toBe('qaroom.content.posts.comm_x.created')",
      filename: 'services/content/src/emit.test.ts',
    },
    // ...as is *.spec.ts.
    {
      code: "expect(subject).toBe('qaroom.content.votes.comm_x.cast')",
      filename: 'services/content/src/emit.spec.ts',
    },
    // A non-subject string is fine in normal source.
    { code: "const greeting = 'hello world'", filename: 'services/content/src/emit.ts' },
  ],
  invalid: [
    {
      code: "const subject = 'qaroom.content.posts.comm_x.created'",
      filename: 'services/content/src/emit.ts',
      errors: [{ messageId: 'raw' }],
    },
    {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: RuleTester fixture — this string IS template-literal source under test.
      code: 'const subject = `qaroom.content.votes.${communityId}.cast`',
      filename: 'services/content/src/emit.ts',
      errors: [{ messageId: 'raw' }],
    },
  ],
})

// JSX-enabled tester for the Milestone-5 frontend rules.
const jsxTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2023,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
})

jsxTester.run('no-mount-composed-story', plugin.rules['no-mount-composed-story'], {
  valid: [
    // The CANONICAL pattern: read args via composeStories, mount the RAW component.
    'const { Default } = composeStories(stories); mount(<Button {...Default.args} />)',
    // Mounting an ordinary component is fine.
    'mount(<Button label="x" />)',
  ],
  invalid: [
    {
      // Destructured composed story mounted directly.
      code: 'const { Default } = composeStories(stories); mount(<Default />)',
      errors: [{ messageId: 'composed' }],
    },
    {
      // Composed map member mounted directly.
      code: 'const composed = composeStories(stories); mount(<composed.Default />)',
      errors: [{ messageId: 'composed' }],
    },
  ],
})

jsxTester.run('atomic-import-direction', plugin.rules['atomic-import-direction'], {
  valid: [
    // Downward import: a molecule may use an atom.
    {
      code: "import { Button } from '../../atoms/Button'",
      filename: 'services/web/src/components/molecules/RolloutStepper/RolloutStepper.tsx',
    },
    // Same-tier sibling (no tier segment in the source) is allowed.
    {
      code: "import { Badge } from '../Badge'",
      filename: 'services/web/src/components/atoms/Button/Button.tsx',
    },
    // A file outside the tiers is skipped entirely.
    {
      code: "import { Organism } from '../components/organisms/X'",
      filename: 'services/web/src/hooks/useThing.ts',
    },
  ],
  invalid: [
    {
      // An atom must not import an organism (upward).
      code: "import { Panel } from '../../organisms/RolloutPanel'",
      filename: 'services/web/src/components/atoms/Button/Button.tsx',
      errors: [{ messageId: 'direction' }],
    },
    {
      // A molecule must not import a page (upward).
      code: "import { Page } from '../../pages/CommunityDashboardPage'",
      filename: 'services/web/src/components/molecules/RolloutStepper/RolloutStepper.tsx',
      errors: [{ messageId: 'direction' }],
    },
  ],
})

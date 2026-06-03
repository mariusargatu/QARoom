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

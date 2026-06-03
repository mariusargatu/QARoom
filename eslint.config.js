import parser from '@typescript-eslint/parser'
import qaroom from 'eslint-plugin-qaroom'

const tsLang = {
  parser,
  parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
}

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      'test-results/**',
      '**/*.gen.ts',
      '**/openapi.yaml',
      '**/migrations/**',
    ],
  },
  // Production source: determinism + structural rules. Tests excluded (see next block).
  {
    files: ['**/*.ts'],
    ignores: [
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/*.property.test.ts',
      '**/tests/**',
      '**/*.config.ts',
      '**/*.setup.ts',
    ],
    languageOptions: tsLang,
    plugins: { qaroom },
    rules: {
      'qaroom/no-new-date': 'error',
      'qaroom/no-unseeded-random': 'error',
      'qaroom/no-public-barrel': 'error',
      'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
    },
  },
  // The determinism production impls + their seeded test doubles are the sanctioned
  // homes for Date/crypto/PRNG primitives. Build/CI scripts are tooling, not the
  // deterministic runtime, so they are exempt too.
  {
    files: [
      'packages/determinism/src/production/**/*.ts',
      'packages/testing-utils/src/determinism/**/*.ts',
      'scripts/**/*.ts',
    ],
    rules: {
      'qaroom/no-new-date': 'off',
      'qaroom/no-unseeded-random': 'off',
    },
  },
  // Tests: shape + discipline rules.
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/*.property.test.ts'],
    languageOptions: tsLang,
    plugins: { qaroom },
    rules: {
      'qaroom/test-name-shape': 'error',
      'qaroom/no-conditional-in-test': 'error',
      'qaroom/no-snapshot': 'error',
      'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
    },
  },
]

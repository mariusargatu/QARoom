// eslint-plugin-qaroom ships as plain JS (no build step, no .d.ts). The conventions
// oracle embeds it via the ESLint Linter API, so it needs a module shape here.
declare module 'eslint-plugin-qaroom' {
  import type { ESLint } from 'eslint'

  const plugin: ESLint.Plugin
  export default plugin
}

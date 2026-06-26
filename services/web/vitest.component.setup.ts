// Load the semantic-token stylesheet so component tests render with the real colors/spacing. The
// Tailwind Vite plugin (vitest.component.config.ts) compiles the `@theme`. NOTE: the app's webfonts
// (Hanken Grotesk / Fraunces) load from a Google Fonts <link> in index.html, NOT from globals.css, so
// the visual baseline renders in the CSS fallback font — that is fine for regression (baseline and
// check render identically in the pinned container, ADR-0027 §3), it just is not pixel-identical to
// the deployed app. Harmless for interaction tests.
import './src/styles/globals.css'

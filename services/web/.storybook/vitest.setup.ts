import { setProjectAnnotations } from '@storybook/react-vite'
import * as previewAnnotations from './preview'

// Portable-stories glue (Milestone 8, ADR-0005): registers the preview decorators/globals so a
// story's `play()` inherits the ThemeProvider + a11y config when run headlessly under the
// `@storybook/addon-vitest` browser project. Browser-required — no dangling script is shipped;
// wire `vitest --project=storybook` once Playwright browsers are installed.
setProjectAnnotations([previewAnnotations])

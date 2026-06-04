import type { Preview } from '@storybook/react-vite'
import '../src/styles/globals.css'

// The semantic tokens load globally so every story renders in the real dark theme.
const preview: Preview = {
  parameters: {
    layout: 'centered',
    backgrounds: { disable: true },
  },
}

export default preview
